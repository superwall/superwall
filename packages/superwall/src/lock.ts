import * as fs from "node:fs";
import * as path from "node:path";

export type SurfaceBinding = {
  paywallId: string;
  snapshot?: string;
};

export type SurfaceBindings = Record<string, SurfaceBinding>;

export type LockFile = {
  version: 1;
  apps: Record<string, string>;
  paywalls: Record<string, SurfaceBindings>;
  funnels: Record<string, SurfaceBindings>;
};

const emptyLock = (): LockFile => ({ version: 1, apps: {}, paywalls: {}, funnels: {} });

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
    for (const [alias, candidate] of Object.entries(entry)) {
      const binding = readBinding(candidate);
      if (binding) bindings[alias] = binding;
    }
    if (Object.keys(bindings).length > 0) section[surfaceId] = bindings;
  }
  return section;
};

export const parseLock = (parsed: unknown): LockFile | undefined => {
  if (!isRecord(parsed)) return undefined;
  if (parsed.version !== 1) return undefined;
  const lock = emptyLock();
  if (isRecord(parsed.apps)) {
    for (const [alias, id] of Object.entries(parsed.apps)) {
      if (typeof id === "string") lock.apps[alias] = id;
    }
  }
  lock.paywalls = readSection(parsed.paywalls);
  lock.funnels = readSection(parsed.funnels);
  return lock;
};

export const readLock = (superwallDir: string): LockFile => {
  const file = path.join(superwallDir, "superwall.lock");
  if (!fs.existsSync(file)) return emptyLock();
  try {
    return parseLock(JSON.parse(fs.readFileSync(file, "utf8"))) ?? emptyLock();
  } catch {}
  return emptyLock();
};

export const firstBinding = (bindings: SurfaceBindings | undefined): SurfaceBinding | undefined =>
  bindings === undefined ? undefined : Object.values(bindings)[0];

export const boundPaywallIds = (bindings: SurfaceBindings | undefined): string[] =>
  bindings === undefined ? [] : Object.values(bindings).map((binding) => binding.paywallId);
