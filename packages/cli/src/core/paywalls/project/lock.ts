import * as fs from "node:fs";
import * as path from "node:path";

export interface SurfaceBinding {
  paywallId: string;
  snapshot?: string;
}

export type SurfaceBindings = Record<string, SurfaceBinding>;

const EXPLAINER =
  "Commit this file: it binds each paywall to its dashboard entry, per app, so every machine and CI push to the same place. Managed by the Superwall CLI.";

export interface LockFile {
  version: 1;
  apps: Record<string, string>;
  paywalls: Record<string, SurfaceBindings>;
  funnels: Record<string, SurfaceBindings>;
}

export type SurfaceKind = "paywall" | "funnel";

const emptyLock = (): LockFile => ({ version: 1, apps: {}, paywalls: {}, funnels: {} });

const lockPath = (superwallDir: string) => path.join(superwallDir, "superwall.lock");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBinding = (value: unknown): SurfaceBinding | undefined => {
  if (!isRecord(value) || typeof value.paywallId !== "string") return undefined;
  return typeof value.snapshot === "string"
    ? { paywallId: value.paywallId, snapshot: value.snapshot }
    : { paywallId: value.paywallId };
};

const readSection = (value: unknown): Record<string, SurfaceBindings> => {
  const section: Record<string, SurfaceBindings> = {};
  if (!isRecord(value)) return section;
  for (const [surfaceId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const bindings: SurfaceBindings = {};
    for (const [platform, candidate] of Object.entries(entry)) {
      const binding = readBinding(candidate);
      if (binding) bindings[platform] = binding;
    }
    if (Object.keys(bindings).length > 0) section[surfaceId] = bindings;
  }
  return section;
};

export function readLock(superwallDir: string): LockFile {
  const file = lockPath(superwallDir);
  if (!fs.existsSync(file)) return emptyLock();
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1) return emptyLock();
    const lock = emptyLock();
    if (isRecord(parsed.apps)) {
      for (const [platform, id] of Object.entries(parsed.apps)) {
        if (typeof id === "string") lock.apps[platform] = id;
      }
    }
    lock.paywalls = readSection(parsed.paywalls);
    lock.funnels = readSection(parsed.funnels);
    return lock;
  } catch {
  }
  return emptyLock();
}

function writeLock(superwallDir: string, lock: LockFile): void {
  const annotated = {
    "//": EXPLAINER,
    version: lock.version,
    apps: lock.apps,
    paywalls: lock.paywalls,
    funnels: lock.funnels,
  };
  fs.writeFileSync(lockPath(superwallDir), `${JSON.stringify(annotated, null, 2)}\n`);
}

const sectionOf = (lock: LockFile, kind: SurfaceKind) =>
  kind === "paywall" ? lock.paywalls : lock.funnels;

export function writeApp(superwallDir: string, platform: string, applicationId: string): void {
  const lock = readLock(superwallDir);
  lock.apps[platform] = applicationId;
  writeLock(superwallDir, lock);
}

export function writeBinding(
  superwallDir: string,
  kind: SurfaceKind,
  surfaceId: string,
  platform: string,
  binding: SurfaceBinding,
): void {
  const lock = readLock(superwallDir);
  const section = sectionOf(lock, kind);
  section[surfaceId] = { ...section[surfaceId], [platform]: binding };
  writeLock(superwallDir, lock);
}

export function writeBindings(
  superwallDir: string,
  kind: SurfaceKind,
  surfaceId: string,
  bindings: SurfaceBindings,
): void {
  const lock = readLock(superwallDir);
  sectionOf(lock, kind)[surfaceId] = { ...bindings };
  writeLock(superwallDir, lock);
}

export function writeSnapshot(
  superwallDir: string,
  kind: SurfaceKind,
  surfaceId: string,
  platform: string,
  snapshot: string,
): void {
  const lock = readLock(superwallDir);
  const section = sectionOf(lock, kind);
  const binding = section[surfaceId]?.[platform];
  if (!binding || binding.snapshot === snapshot) return;
  section[surfaceId] = { ...section[surfaceId], [platform]: { ...binding, snapshot } };
  writeLock(superwallDir, lock);
}

export function removeBinding(
  superwallDir: string,
  kind: SurfaceKind,
  surfaceId: string,
): boolean {
  const lock = readLock(superwallDir);
  const section = sectionOf(lock, kind);
  if (!(surfaceId in section)) return false;
  delete section[surfaceId];
  writeLock(superwallDir, lock);
  return true;
}

export const describeBindings = (bindings: SurfaceBindings): string => {
  const entries = Object.entries(bindings);
  if (entries.length === 1 && entries[0] !== undefined) {
    return `paywall ${entries[0][1].paywallId}`;
  }
  return `paywalls ${entries.map(([platform, binding]) => `${binding.paywallId} (${platform})`).join(", ")}`;
};
