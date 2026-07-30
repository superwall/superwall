import type { SuperwallApi } from "@/core/api/client";
import { listApplications, type Application } from "@/core/api/resources";
import {
  createHeadlessPaywall,
  getPaywallApplicationId,
  listAppPaywalls,
  type HeadlessPaywallRef,
} from "@/core/api/resources";
import type { FrameworkSurface } from "../project/framework";
import { readLock, writeApplicationId, writeBinding } from "../project/lock";

export interface ResolvedBinding {
  paywallId: string;
  applicationId: string;
  source: "lock" | "matched" | "created" | "renamed";
}

export class BindingError extends Error {}

const describe = (surface: FrameworkSurface): string =>
  `${surface.kind} \`${surface.id}\``;

const humanize = (surfaceId: string): string =>
  surfaceId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export async function resolveApplicationId(input: {
  api: SuperwallApi;
  superwallDir: string;
  pickApplication?: (apps: Application[]) => Promise<Application | null>;
}): Promise<string> {
  const { api, superwallDir, pickApplication } = input;

  const lock = readLock(superwallDir);
  if (lock.applicationId) return lock.applicationId;

  const bound = [...Object.values(lock.paywalls), ...Object.values(lock.funnels)][0];
  if (bound) {
    const owner = await getPaywallApplicationId(api, bound.paywallId);
    writeApplicationId(superwallDir, owner);
    return owner;
  }

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
  name?: string;
  surfaces: readonly FrameworkSurface[];
  renamesResolved?: boolean;
  pickApplication?: (apps: Application[]) => Promise<Application | null>;
  create?: boolean;
}): Promise<ResolvedBinding> {
  const { api, superwallDir, surface, pickApplication } = input;
  const create = input.create ?? true;

  const lock = readLock(superwallDir);
  const section = surface.kind === "paywall" ? lock.paywalls : lock.funnels;
  const locked = section[surface.id];
  if (locked) {
    if (lock.applicationId) {
      return { paywallId: locked.paywallId, applicationId: lock.applicationId, source: "lock" };
    }
    const owner = await getPaywallApplicationId(api, locked.paywallId);
    writeApplicationId(superwallDir, owner);
    return { paywallId: locked.paywallId, applicationId: owner, source: "lock" };
  }

  const applicationId = await resolveApplicationId({ api, superwallDir, pickApplication });

  const matches = (paywalls: HeadlessPaywallRef[]): HeadlessPaywallRef | undefined => {
    const headless = paywalls.filter((paywall) => paywall.metadata.headless === "true");
    return (
      headless.find((paywall) => paywall.metadata.headlessSurface === surface.id) ??
      headless.find((paywall) => paywall.identifier === surface.id)
    );
  };

  const match = matches(await listAppPaywalls(api, applicationId));
  if (match) {
    writeBinding(superwallDir, surface.kind, surface.id, { paywallId: match.id });
    return { paywallId: match.id, applicationId, source: "matched" };
  }

  if (!create) {
    throw new BindingError(
      `${describe(surface)} has never been pushed — run \`superwall push\` first.`,
    );
  }

  if (!input.renamesResolved) {
    const section = surface.kind === "paywall" ? lock.paywalls : lock.funnels;
    const onDisk = new Set(
      input.surfaces.filter((candidate) => candidate.kind === surface.kind).map((c) => c.id),
    );
    const orphans = Object.keys(section).filter((id) => !onDisk.has(id));
    if (orphans.length > 0) {
      throw new BindingError(
        `\`${surface.id}\` is unbound while superwall.lock still binds ${orphans.join(", ")}, ` +
          "which no longer exist on disk. Resolve the renames first — `superwall push` asks, or " +
          "declare them with `--rename <old>=<new>`.",
      );
    }
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
    name: input.name?.trim() || humanize(surface.id),
    identifier: surface.id,
  });
  writeBinding(superwallDir, surface.kind, surface.id, { paywallId: created.id });
  return { paywallId: created.id, applicationId, source: "created" };
}
