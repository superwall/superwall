import type { FrameworkSurface } from "../project/framework";
import { readLock, removeBinding, writeBinding } from "../project/lock";

export type SurfaceKind = "paywall" | "funnel";

export interface RenameOrphan {
  kind: SurfaceKind;
  id: string;
  paywallId: string;
}

export interface RenamePair {
  kind: SurfaceKind;
  from: string;
  to: string;
  paywallId: string;
}

export interface RenameDeclaration {
  from: string;
  to: string;
}

export type RenameDecision = { kind: "rename"; orphanId: string } | { kind: "create" };

export type RenameChoice = (input: {
  newcomer: FrameworkSurface;
  orphans: readonly RenameOrphan[];
}) => Promise<RenameDecision>;

export type StaleDecision = "remove" | "keep";

export type StaleChoice = (orphan: RenameOrphan) => Promise<StaleDecision>;

export class RenameError extends Error {}

export function parseRenameFlags(value: unknown): RenameDeclaration[] {
  const entries = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return entries.map((entry) => {
    const text = typeof entry === "string" ? entry.trim() : "";
    const at = text.indexOf("=");
    const from = at === -1 ? "" : text.slice(0, at).trim();
    const to = at === -1 ? "" : text.slice(at + 1).trim();
    if (!from || !to) {
      throw new RenameError(
        `--rename takes <old>=<new>, e.g. --rename plus-upgrade=pro-upgrade` +
          (text ? ` (got "${text}")` : ""),
      );
    }
    return { from, to };
  });
}

function unresolvedError(
  orphans: readonly RenameOrphan[],
  newcomers: readonly FrameworkSurface[],
): RenameError {
  return new RenameError(
    [
      "Cannot tell whether these are new or renamed, and this run cannot ask.",
      "",
      "Bound in superwall.lock, but no directory on disk:",
      ...orphans.map((orphan) => `  ${orphan.id} → paywall ${orphan.paywallId}`),
      "On disk, but not in superwall.lock:",
      ...newcomers.map((newcomer) => `  ${newcomer.id}`),
      "",
      "Declare each rename, then run again:",
      ...newcomers.flatMap((newcomer) =>
        orphans.map((orphan) => `  --rename ${orphan.id}=${newcomer.id}`),
      ),
      "",
      "If one of these paywalls is genuinely gone, remove its entry from",
      "superwall.lock by hand and run again.",
      "",
      "Refusing to create — the bound paywalls are what production serves.",
    ].join("\n"),
  );
}

export async function resolveRenames(input: {
  superwallDir: string;
  surfaces: readonly FrameworkSurface[];
  declared?: readonly RenameDeclaration[];
  choose?: RenameChoice;
  chooseStale?: StaleChoice;
  notice?: (message: string) => void;
}): Promise<{ renamed: RenamePair[]; stale: RenameOrphan[]; dropped: RenameOrphan[] }> {
  const lock = readLock(input.superwallDir);
  const orphans: RenameOrphan[] = [];
  const newcomers: FrameworkSurface[] = [];

  for (const kind of ["paywall", "funnel"] as const) {
    const section = kind === "paywall" ? lock.paywalls : lock.funnels;
    const onDisk = input.surfaces.filter((surface) => surface.kind === kind);
    const ids = new Set(onDisk.map((surface) => surface.id));
    for (const [id, binding] of Object.entries(section).sort(([a], [b]) => a.localeCompare(b))) {
      if (!ids.has(id)) orphans.push({ kind, id, paywallId: binding.paywallId });
    }
    for (const surface of onDisk) {
      if (!(surface.id in section)) newcomers.push(surface);
    }
  }

  const renamed: RenamePair[] = [];
  const rebind = (orphan: RenameOrphan, newcomer: FrameworkSurface) => {
    writeBinding(input.superwallDir, newcomer.kind, newcomer.id, {
      paywallId: orphan.paywallId,
    });
    removeBinding(input.superwallDir, orphan.kind, orphan.id);
    renamed.push({
      kind: newcomer.kind,
      from: orphan.id,
      to: newcomer.id,
      paywallId: orphan.paywallId,
    });
    orphans.splice(orphans.indexOf(orphan), 1);
    newcomers.splice(newcomers.indexOf(newcomer), 1);
  };

  for (const declaration of input.declared ?? []) {
    const newcomer = newcomers.find((candidate) => candidate.id === declaration.to);
    if (!newcomer) {
      throw new RenameError(
        `--rename ${declaration.from}=${declaration.to}: no unbound directory named ` +
          `"${declaration.to}".`,
      );
    }
    const orphan = orphans.find(
      (candidate) => candidate.id === declaration.from && candidate.kind === newcomer.kind,
    );
    if (!orphan) {
      throw new RenameError(
        `--rename ${declaration.from}=${declaration.to}: superwall.lock has no ${newcomer.kind} ` +
          `"${declaration.from}" waiting to be renamed.`,
      );
    }
    rebind(orphan, newcomer);
  }

  for (const newcomer of [...newcomers]) {
    const candidates = orphans.filter((orphan) => orphan.kind === newcomer.kind);
    if (candidates.length === 0) continue;
    if (!input.choose) {
      throw unresolvedError(candidates, [newcomer]);
    }
    const decision = await input.choose({ newcomer, orphans: candidates });
    if (decision.kind === "rename") {
      const orphan = candidates.find((candidate) => candidate.id === decision.orphanId);
      if (!orphan) {
        throw new RenameError(`No pending rename candidate named "${decision.orphanId}".`);
      }
      rebind(orphan, newcomer);
    }
  }

  const dropped: RenameOrphan[] = [];
  const kept: RenameOrphan[] = [];

  for (const orphan of orphans) {
    if (!input.chooseStale) {
      input.notice?.(
        `\`${orphan.id}\` is still bound to paywall ${orphan.paywallId} but no longer exists on ` +
          `disk — remove it from superwall.lock if that paywall is gone.`,
      );
      kept.push(orphan);
      continue;
    }
    if ((await input.chooseStale(orphan)) === "remove") {
      removeBinding(input.superwallDir, orphan.kind, orphan.id);
      dropped.push(orphan);
    } else {
      kept.push(orphan);
    }
  }

  return { renamed, stale: kept, dropped };
}
