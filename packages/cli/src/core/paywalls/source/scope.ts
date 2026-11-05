import { TYPES_FILE } from "@/core/paywalls/project/types";
import {
  formatLock,
  NewerLockError,
  originKey,
  parseLock,
  type LockFile,
  type SurfaceKind,
} from "@/core/paywalls/project/lock";

export interface SurfaceScope {
  kind: SurfaceKind;
  id: string;
}

export interface WorkspaceScope {
  kind: "workspace";
  id: string;
}

export interface ProjectScope {
  kind: "project";
}

export type SourceScope = SurfaceScope | WorkspaceScope | ProjectScope;

export type PathClass = "own" | "other" | "shared" | "derived";

export const LOCK_FILE = "superwall.lock";

export const WORKSPACE_FILE = "superwall.workspace.json";

export const DERIVED_FILES: ReadonlySet<string> = new Set([LOCK_FILE, TYPES_FILE]);

export const WORKSPACE_DERIVED_FILES: ReadonlySet<string> = new Set([WORKSPACE_FILE]);

export const derivedFilesOf = (scope: SourceScope): ReadonlySet<string> =>
  scope.kind === "workspace" ? WORKSPACE_DERIVED_FILES : DERIVED_FILES;

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
  if (scope.kind === "workspace") return "own";
  const surface = surfaceOf(relative);
  if (!surface) return "shared";
  if (scope.kind === "project") return "other";
  return surface.kind === scope.kind && surface.id === scope.id ? "own" : "other";
}

export const isSurfaceRoot = (top: string, scope?: SourceScope): boolean =>
  scope?.kind !== "workspace" && SURFACE_DIRS[top] !== undefined;

export const isOtherSurfaceDir = (top: string, child: string, scope: SourceScope): boolean => {
  if (scope.kind === "workspace") return false;
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
  options: { replaceUnreadable?: boolean } = {},
): string {
  const own = readable(mine);
  if (!("lock" in own)) return mine;
  if (theirs === undefined) return formatLock(withoutSources(own.lock));
  const read = readable(theirs);
  if (!("lock" in read)) {
    if (!options.replaceUnreadable) throw new SourceLockUnreadableError(read.reason);
    return formatLock(withoutSources(own.lock));
  }
  return mergeLocks(read.lock, own.lock, scope);
}

function mergeLocks(other: LockFile, own: LockFile, scope: SurfaceScope | ProjectScope): string {
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
  if (scope.kind === "project") {
    if (other.origins) merged.origins = other.origins;
    return formatLock(merged);
  }
  const target = section(merged);
  const theirEntry = section(other)[scope.id] ?? {};
  const mineEntry = section(own)[scope.id] ?? {};
  const entry = Object.fromEntries([
    ...Object.entries(theirEntry).filter(([platform]) => conflicting.has(platform)),
    ...Object.entries(mineEntry).filter(([platform]) => !conflicting.has(platform)),
  ]);
  if (Object.keys(entry).length > 0) target[scope.id] = entry;
  else delete target[scope.id];

  const key = originKey(scope.kind, scope.id);
  const origins = { ...other.origins };
  const mineOrigin = own.origins?.[key];
  if (mineOrigin) origins[key] = mineOrigin;
  else delete origins[key];
  if (Object.keys(origins).length > 0) merged.origins = origins;

  return formatLock(merged);
}

const withoutSources = ({ sources: _, ...lock }: LockFile): LockFile => lock;
