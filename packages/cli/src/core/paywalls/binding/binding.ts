import type { SuperwallApi } from "@/core/api/client";
import {
  createHeadlessPaywall,
  listAppPaywalls,
  type HeadlessPaywallRef,
} from "@/core/api/resources";
import type { FrameworkSurface } from "../project/framework";
import { readLock, writeBinding } from "../project/lock";

export interface ResolvedApp {
  platform: string;
  applicationId: string;
}

export interface ResolvedBinding {
  paywallId: string;
  applicationId: string;
  platform: string;
  source: "lock" | "matched" | "created" | "renamed";
}

export class BindingError extends Error {}

export interface AdoptCandidate {
  surface: FrameworkSurface;
  paywallId: string;
  applicationId: string;
  platform: string;
}

export type ConfirmAdopt = (candidate: AdoptCandidate) => Promise<boolean>;

const describe = (surface: FrameworkSurface): string => `${surface.kind} \`${surface.id}\``;

const humanize = (surfaceId: string): string =>
  surfaceId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export async function resolveBinding(input: {
  api: SuperwallApi;
  superwallDir: string;
  surface: FrameworkSurface;
  app: ResolvedApp;
  name?: string;
  surfaces: readonly FrameworkSurface[];
  renamesResolved?: boolean;
  create?: boolean;
  confirmAdopt?: ConfirmAdopt;
}): Promise<ResolvedBinding> {
  const { api, superwallDir, surface, app } = input;
  const { platform, applicationId } = app;
  const create = input.create ?? true;

  const lock = readLock(superwallDir);
  const section = surface.kind === "paywall" ? lock.paywalls : lock.funnels;
  const locked = section[surface.id]?.[platform];
  if (locked) {
    return { paywallId: locked.paywallId, applicationId, platform, source: "lock" };
  }

  const matches = (paywalls: HeadlessPaywallRef[]): HeadlessPaywallRef | undefined => {
    const headless = paywalls.filter((paywall) => paywall.metadata.headless === "true");
    return (
      headless.find((paywall) => paywall.metadata.headlessSurface === surface.id) ??
      headless.find((paywall) => paywall.identifier === surface.id)
    );
  };

  const match = matches(await listAppPaywalls(api, applicationId));
  if (match) {
    await requireAdoption(input.confirmAdopt, {
      surface,
      paywallId: match.id,
      applicationId,
      platform,
    });
    writeBinding(superwallDir, surface.kind, surface.id, platform, { paywallId: match.id });
    return { paywallId: match.id, applicationId, platform, source: "matched" };
  }

  if (!create) {
    throw new BindingError(
      `${describe(surface)} has never been pushed to \`${platform}\` — run \`superwall push\` first.`,
    );
  }

  if (!input.renamesResolved) {
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
      `${describe(surface)} matches archived paywall ${archived.id} on \`${platform}\`. ` +
        `Restore it in the dashboard to push to it, or rename the directory.`,
    );
  }

  const created = await createHeadlessPaywall(api, {
    applicationId,
    name: input.name?.trim() || humanize(surface.id),
    identifier: surface.id,
  });
  writeBinding(superwallDir, surface.kind, surface.id, platform, { paywallId: created.id });
  return { paywallId: created.id, applicationId, platform, source: "created" };
}

async function requireAdoption(
  confirm: ConfirmAdopt | undefined,
  candidate: AdoptCandidate,
): Promise<void> {
  if (confirm && (await confirm(candidate))) return;
  const { surface, paywallId, applicationId, platform } = candidate;
  const lockLine = `"${surface.id}": { "${platform}": { "paywallId": "${paywallId}" } }`;
  throw new BindingError(
    [
      `App ${applicationId} already has a paywall \`${surface.id}\` (${paywallId}) that superwall.lock doesn't bind, so nothing was pushed.`,
      `  - It's yours: run \`superwall push\` interactively and confirm, or add ${lockLine} under "${surface.kind === "paywall" ? "paywalls" : "funnels"}" in superwall.lock.`,
      `  - It isn't: rename the directory, and the next push creates a new paywall.`,
    ].join("\n"),
  );
}
