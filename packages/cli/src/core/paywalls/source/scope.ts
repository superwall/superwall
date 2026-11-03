import { TYPES_FILE } from "@/core/paywalls/project/types";
import {
  formatLock,
  NewerLockError,
  originKey,
  parseLock,
  type LockFile,
  type SurfaceKind,
} from "@/core/paywalls/project/lock";

export interface SourceScope {
  kind: SurfaceKind;
  id: string;
}

export type PathClass = "own" | "other" | "shared" | "derived";

export const LOCK_FILE = "superwall.lock";

export const DERIVED_FILES: ReadonlySet<string> = new Set([LOCK_FILE, TYPES_FILE]);

const SURFACE_DIRS: Readonly<Record<string, SurfaceKind>> = { paywalls: "paywall", funnels: "funnel" };

export function surfaceOf(relative: string): SourceScope | undefined {
  const [top, id, ...rest] = relative.split("/");
  const kind = top === undefined ? undefined : SURFACE_DIRS[top];
  if (!kind || !id || rest.length === 0) return undefined;
  return { kind, id };
}

export function classifyPath(relative: string, scope: SourceScope): PathClass {
  if (DERIVED_FILES.has(relative)) return "derived";
  const surface = surfaceOf(relative);
  if (!surface) return "shared";
  return surface.kind === scope.kind && surface.id === scope.id ? "own" : "other";
}

export const isOtherSurfaceDir = (top: string, child: string, scope: SourceScope): boolean => {
  const kind = SURFACE_DIRS[top];
  return kind !== undefined && !(kind === scope.kind && child === scope.id);
};

const readable = (text: string | undefined): LockFile | undefined => {
  if (text === undefined) return undefined;
  try {
    return parseLock(text, LOCK_FILE);
  } catch (error) {
    if (error instanceof NewerLockError) throw error;
    return undefined;
  }
};

export function mergeLockText(theirs: string | undefined, mine: string, scope: SourceScope): string {
  const own = readable(mine);
  const other = readable(theirs);
  if (!own) return mine;
  if (!other) return formatLock(withoutSources(own));

  const section = (lock: LockFile) => (scope.kind === "paywall" ? lock.paywalls : lock.funnels);
  const merged: LockFile = {
    version: 1,
    apps: { ...other.apps, ...own.apps },
    paywalls: { ...other.paywalls },
    funnels: { ...other.funnels },
  };
  const target = section(merged);
  const mineEntry = section(own)[scope.id];
  if (mineEntry) target[scope.id] = mineEntry;
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
