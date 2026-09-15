import * as fs from "node:fs";
import * as path from "node:path";

export type SurfaceBinding = {
  paywallId: string;
  snapshot?: string;
};

export type SurfaceBindings = Record<string, SurfaceBinding>;

export type PaywallOrigin = {
  paywallId: string;
  url: string;
};

export type ScreenOrigin = {
  path: string;
  framework: "swiftui" | "uikit" | "compose" | "android-views" | "react-native" | "flutter";
  screenshot?: string;
};

export type SurfaceOrigin = PaywallOrigin | ScreenOrigin;

export const isScreenOrigin = (origin: SurfaceOrigin): origin is ScreenOrigin => "path" in origin;

const SCREEN_FRAMEWORKS: ReadonlySet<string> = new Set(["swiftui", "uikit", "compose", "android-views", "react-native", "flutter"]);

const readOrigin = (candidate: Record<string, unknown>): SurfaceOrigin | undefined => {
  if (typeof candidate.paywallId === "string" && typeof candidate.url === "string") {
    return { paywallId: candidate.paywallId, url: candidate.url };
  }
  if (
    typeof candidate.path === "string" &&
    typeof candidate.framework === "string" &&
    SCREEN_FRAMEWORKS.has(candidate.framework)
  ) {
    const framework = candidate.framework as ScreenOrigin["framework"];
    return typeof candidate.screenshot === "string"
      ? { path: candidate.path, framework, screenshot: candidate.screenshot }
      : { path: candidate.path, framework };
  }
  return undefined;
};

export type LockFile = {
  version: 1;
  apps: Record<string, string>;
  paywalls: Record<string, SurfaceBindings>;
  funnels: Record<string, SurfaceBindings>;
  origins?: Record<string, SurfaceOrigin>;
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
  if (isRecord(parsed.origins)) {
    const origins: Record<string, SurfaceOrigin> = {};
    for (const [key, candidate] of Object.entries(parsed.origins)) {
      if (!isRecord(candidate)) continue;
      const origin = readOrigin(candidate);
      if (origin) origins[key] = origin;
    }
    if (Object.keys(origins).length > 0) lock.origins = origins;
  }
  return lock;
};

export const originOf = (
  lock: LockFile,
  kind: "paywall" | "funnel",
  surfaceId: string,
): SurfaceOrigin | undefined => lock.origins?.[`${kind}/${surfaceId}`];

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
