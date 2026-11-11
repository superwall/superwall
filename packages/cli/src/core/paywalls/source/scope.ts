import { TYPES_FILE } from "@/core/paywalls/project/types";
import {
  formatLock,
  NewerLockError,
  originKey,
  parseLock,
  type LockFile,
  type SurfaceBindings,
  type SurfaceKind,
} from "@/core/paywalls/project/lock";

export interface SurfaceScope {
  kind: SurfaceKind;
  id: string;
}

export interface ArtifactScope {
  kind: "artifact";
  id: string;
}

export interface ProjectScope {
  kind: "project";
}

export type SourceScope = SurfaceScope | ArtifactScope | ProjectScope;

export type PathClass = "own" | "other" | "shared" | "derived";

export const LOCK_FILE = "superwall.lock";

export const ARTIFACT_FILE = "superwall.artifact.json";

export const DERIVED_FILES: ReadonlySet<string> = new Set([LOCK_FILE, TYPES_FILE]);

export const ARTIFACT_DERIVED_FILES: ReadonlySet<string> = new Set([ARTIFACT_FILE]);

export const derivedFilesOf = (scope: SourceScope): ReadonlySet<string> =>
  scope.kind === "artifact" ? ARTIFACT_DERIVED_FILES : DERIVED_FILES;

const SURFACE_DIRS: Readonly<Record<string, SurfaceKind>> = {
  paywalls: "paywall",
  funnels: "funnel",
};

export function surfaceOf(relative: string): SurfaceScope | undefined {
  const [top, id, ...rest] = relative.split("/");
  const kind = top === undefined ? undefined : SURFACE_DIRS[top];
  if (!kind || !id || rest.length === 0) return undefined;
  return { kind, id };
}

export function classifyPath(relative: string, scope: SourceScope): PathClass {
  if (derivedFilesOf(scope).has(relative)) return "derived";
  if (scope.kind === "artifact") return "own";
  const surface = surfaceOf(relative);
  if (!surface) return "shared";
  if (scope.kind === "project") return "other";
  return surface.kind === scope.kind && surface.id === scope.id ? "own" : "other";
}

export const isSurfaceRoot = (top: string, scope?: SourceScope): boolean =>
  scope?.kind !== "artifact" && SURFACE_DIRS[top] !== undefined;

export const isOtherSurfaceDir = (top: string, child: string, scope: SourceScope): boolean => {
  if (scope.kind === "artifact") return false;
  const kind = SURFACE_DIRS[top];
  if (kind === undefined) return false;
  return scope.kind === "project" || !(kind === scope.kind && child === scope.id);
};

export class SourceLockUnreadableError extends Error {
  constructor(reason: string) {
    super(
      `The source repo's superwall.lock can't be read (${reason}), so its bindings for other paywalls can't be kept. ` +
        "Rerun with --overwrite-source to replace it with yours.",
    );
  }
}

type Readable = { lock: LockFile } | { reason: string };

const readable = (text: string): Readable => {
  try {
    return { lock: parseLock(text, LOCK_FILE) };
  } catch (error) {
    if (error instanceof NewerLockError) throw error;
    return { reason: error instanceof Error ? error.message : String(error) };
  }
};

export function mergeLockText(
  theirs: string | undefined,
  mine: string,
  scope: SurfaceScope | ProjectScope,
  options: { replaceUnreadable?: boolean; base?: string } = {},
): string {
  const own = readable(mine);
  if (!("lock" in own)) return mine;
  if (theirs === undefined) return formatLock(scoped(own.lock, scope));
  const read = readable(theirs);
  if (!("lock" in read)) {
    if (!options.replaceUnreadable) throw new SourceLockUnreadableError(read.reason);
    return formatLock(scoped(own.lock, scope));
  }
  const base = options.base === undefined ? undefined : readable(options.base);
  return mergeLocks(read.lock, own.lock, scope, base && "lock" in base ? base.lock : undefined);
}

const SECTIONS = ["paywalls", "funnels"] as const;

const sameBindings = (a: SurfaceBindings, b: SurfaceBindings): boolean => {
  const platforms = Object.keys(a);
  return (
    platforms.length === Object.keys(b).length &&
    platforms.every(
      (platform) =>
        a[platform]?.paywallId === b[platform]?.paywallId &&
        a[platform]?.snapshot === b[platform]?.snapshot &&
        a[platform]?.sourcePending === b[platform]?.sourcePending,
    )
  );
};

function dropRemoved(merged: LockFile, own: LockFile, base: LockFile): void {
  for (const key of SECTIONS) {
    const bound = new Set(
      Object.values(own[key]).flatMap((bindings) =>
        Object.values(bindings).map((binding) => binding.paywallId),
      ),
    );
    for (const [id, synced] of Object.entries(base[key])) {
      const theirs = merged[key][id];
      if (id in own[key] || theirs === undefined || !sameBindings(theirs, synced)) continue;
      if (Object.values(synced).some((binding) => bound.has(binding.paywallId))) continue;
      delete merged[key][id];
    }
  }
}

function dropFormerNames(
  section: Record<string, SurfaceBindings>,
  surfaceId: string,
  entry: SurfaceBindings,
): void {
  for (const [id, bindings] of Object.entries(section)) {
    if (id === surfaceId) continue;
    const kept = Object.entries(bindings).filter(
      ([platform, binding]) => entry[platform]?.paywallId !== binding.paywallId,
    );
    if (kept.length === Object.keys(bindings).length) continue;
    if (kept.length > 0) section[id] = Object.fromEntries(kept);
    else delete section[id];
  }
}

function mergeLocks(
  other: LockFile,
  own: LockFile,
  scope: SurfaceScope | ProjectScope,
  base?: LockFile,
): string {
  const section = (lock: LockFile) => (scope.kind === "paywall" ? lock.paywalls : lock.funnels);
  const conflicting = new Set(
    Object.entries(own.apps)
      .filter(
        ([platform, app]) => other.apps[platform] !== undefined && other.apps[platform] !== app,
      )
      .map(([platform]) => platform),
  );
  const ownApps = Object.fromEntries(
    Object.entries(own.apps).filter(([platform]) => !conflicting.has(platform)),
  );
  const merged: LockFile = {
    version: 1,
    apps: { ...other.apps, ...ownApps },
    paywalls: { ...other.paywalls },
    funnels: { ...other.funnels },
  };
  if (base) dropRemoved(merged, own, base);
  if (scope.kind === "project") {
    if (other.origins) merged.origins = other.origins;
    return formatLock(merged);
  }
  const target = section(merged);
  const theirEntry = section(other)[scope.id] ?? {};
  const mineEntry = section(own)[scope.id] ?? {};
  const entry: SurfaceBindings = Object.fromEntries([
    ...Object.entries(theirEntry).filter(([platform]) => conflicting.has(platform)),
    ...Object.entries(mineEntry).filter(([platform]) => !conflicting.has(platform)),
  ]);
  if (Object.keys(entry).length > 0) target[scope.id] = entry;
  else delete target[scope.id];
  dropFormerNames(target, scope.id, entry);

  const key = originKey(scope.kind, scope.id);
  const origins = { ...other.origins };
  const mineOrigin = own.origins?.[key];
  if (mineOrigin) origins[key] = mineOrigin;
  else delete origins[key];
  if (Object.keys(origins).length > 0) merged.origins = origins;

  return formatLock(merged);
}

const withoutSources = ({ sources: _, ...lock }: LockFile): LockFile => lock;

const scoped = (lock: LockFile, scope: SurfaceScope | ProjectScope): LockFile => {
  const { origins: _, ...rest } = withoutSources(lock);
  return scope.kind === "project" ? { ...rest, paywalls: {}, funnels: {} } : withoutSources(lock);
};
