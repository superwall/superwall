import type { SuperwallApi } from "@/core/api/client";
import { listApplications, type Application } from "@/core/api/resources";
import {
  createHeadlessPaywall,
  listAppPaywalls,
  type HeadlessPaywallRef,
} from "@/core/api/resources";
import type { FrameworkSurface } from "./framework";
import { readLock, writeApplicationId, writeBinding } from "./lock";

export interface ResolvedBinding {
  paywallId: string;
  source: "lock" | "matched" | "created";
}

export class BindingError extends Error {}

const describe = (surface: FrameworkSurface): string =>
  `${surface.kind} \`${surface.id}\``;

const humanize = (surfaceId: string): string =>
  surfaceId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

async function resolveApplicationId(input: {
  api: SuperwallApi;
  superwallDir: string;
  pickApplication?: (apps: Application[]) => Promise<Application | null>;
}): Promise<string> {
  const { api, superwallDir, pickApplication } = input;

  const locked = readLock(superwallDir).applicationId;
  if (locked) return locked;

  const apps = await listApplications(api);
  if (apps.length === 1) {
    const only = apps[0]!;
    writeApplicationId(superwallDir, String(only.id));
    return String(only.id);
  }

  if (apps.length > 1 && pickApplication) {
    const picked = await pickApplication(apps);
    if (picked) {
      writeApplicationId(superwallDir, String(picked.id));
      return String(picked.id);
    }
  }

  throw new BindingError(
    apps.length === 0
      ? "Your account has no apps yet — create one with `superwall apps create` or in the dashboard."
      : "Several apps in your account — run `superwall push` interactively once to pick one; the choice is saved to superwall.lock.",
  );
}

export async function resolveBinding(input: {
  api: SuperwallApi;
  superwallDir: string;
  surface: FrameworkSurface;
  pickApplication?: (apps: Application[]) => Promise<Application | null>;
  create?: boolean;
}): Promise<ResolvedBinding> {
  const { api, superwallDir, surface, pickApplication } = input;
  const create = input.create ?? true;

  const lock = readLock(superwallDir);
  const section = surface.kind === "paywall" ? lock.paywalls : lock.funnels;
  const locked = section[surface.id];
  if (locked) {
    return { paywallId: locked.paywallId, source: "lock" };
  }

  const applicationId = await resolveApplicationId({ api, superwallDir, pickApplication });

  const matches = (paywalls: HeadlessPaywallRef[]): HeadlessPaywallRef | undefined =>
    paywalls.find((paywall) => paywall.metadata.headlessSurface === surface.id) ??
    paywalls.find((paywall) => paywall.identifier === surface.id);

  const match = matches(await listAppPaywalls(api, applicationId));
  if (match) {
    writeBinding(superwallDir, surface.kind, surface.id, { paywallId: match.id });
    return { paywallId: match.id, source: "matched" };
  }

  if (!create) {
    throw new BindingError(
      `${describe(surface)} has never been pushed — run \`superwall push\` first.`,
    );
  }

  const archived = matches(await listAppPaywalls(api, applicationId, { archived: true }));
  if (archived) {
    throw new BindingError(
      `${describe(surface)} matches archived paywall ${archived.id}. ` +
        `Restore it in the dashboard to push to it, or rename the directory.`,
    );
  }

  const created = await createHeadlessPaywall(api, {
    applicationId,
    name: humanize(surface.id),
    identifier: surface.id,
  });
  writeBinding(superwallDir, surface.kind, surface.id, { paywallId: created.id });
  return { paywallId: created.id, source: "created" };
}
