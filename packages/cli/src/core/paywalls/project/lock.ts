import * as fs from "node:fs";
import * as path from "node:path";

export interface SurfaceBinding {
  paywallId: string;
  snapshot?: string;
  sourcePending?: number;
}

export interface PushedSnapshot {
  snapshot: string;
  sourcePending?: number;
}

export type SurfaceBindings = Record<string, SurfaceBinding>;

export interface PaywallOrigin {
  paywallId: string;
  url: string;
}

export type ScreenFramework = "swiftui" | "uikit" | "compose" | "android-views" | "react-native" | "flutter";

export interface ScreenOrigin {
  path: string;
  framework: ScreenFramework;
  screenshot?: string;
}

export type SurfaceOrigin = PaywallOrigin | ScreenOrigin;

export const isScreenOrigin = (origin: SurfaceOrigin): origin is ScreenOrigin => "path" in origin;

const isFileName = (value: unknown): value is string =>
  typeof value === "string" && value !== "" && !/[\\/]/.test(value) && !value.startsWith(".");

const SCREEN_FRAMEWORKS: ReadonlySet<string> = new Set(["swiftui", "uikit", "compose", "android-views", "react-native", "flutter"]);

const readOrigin = (candidate: Record<string, unknown>): SurfaceOrigin | undefined => {
  if (typeof candidate.paywallId === "string" && typeof candidate.url === "string") {
    return { paywallId: candidate.paywallId, url: candidate.url };
  }
  if (typeof candidate.path === "string" && typeof candidate.framework === "string" && SCREEN_FRAMEWORKS.has(candidate.framework)) {
    const framework = candidate.framework as ScreenFramework;
    return isFileName(candidate.screenshot)
      ? { path: candidate.path, framework, screenshot: candidate.screenshot }
      : { path: candidate.path, framework };
  }
  return undefined;
};

const EXPLAINER =
  "Commit this file: it binds each paywall to its dashboard entry, per app, so every machine and CI push to the same place, and the source commit each app was last synced to. Managed by the Superwall CLI.";

export interface LockFile {
  version: 1;
  apps: Record<string, string>;
  paywalls: Record<string, SurfaceBindings>;
  funnels: Record<string, SurfaceBindings>;
  origins?: Record<string, SurfaceOrigin>;
  sources?: Record<string, string>;
}

export type SurfaceKind = "paywall" | "funnel";

const emptyLock = (): LockFile => ({ version: 1, apps: {}, paywalls: {}, funnels: {} });

export const originKey = (kind: SurfaceKind, surfaceId: string): string => `${kind}/${surfaceId}`;

const readOrigins = (value: unknown): Record<string, SurfaceOrigin> | undefined => {
  if (!isRecord(value)) return undefined;
  const origins: Record<string, SurfaceOrigin> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)) continue;
    const origin = readOrigin(candidate);
    if (origin) origins[key] = origin;
  }
  return Object.keys(origins).length > 0 ? origins : undefined;
};

const lockPath = (superwallDir: string) => path.join(superwallDir, "superwall.lock");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBinding = (value: unknown): SurfaceBinding | undefined => {
  if (!isRecord(value) || typeof value.paywallId !== "string") return undefined;
  if (typeof value.snapshot !== "string") return { paywallId: value.paywallId };
  return Number.isInteger(value.sourcePending)
    ? { paywallId: value.paywallId, snapshot: value.snapshot, sourcePending: Number(value.sourcePending) }
    : { paywallId: value.paywallId, snapshot: value.snapshot };
};

const COMMIT_SHA = /^[0-9a-f]{40}$/;

export const parseSources = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && COMMIT_SHA.test(entry[1]),
    ),
  );
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

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})( |$)/m;

function parseLockFile(file: string): Record<string, unknown> {
  const text = fs.readFileSync(file, "utf8");
  if (CONFLICT_MARKER.test(text)) {
    throw new Error(`${file} has unresolved merge conflicts — resolve them, then run again.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} isn't valid JSON (${reason}) — fix it or restore it from git.`);
  }
  if (!isRecord(parsed) || typeof parsed.version !== "number") {
    throw new Error(`${file} isn't a Superwall lock file — fix it or restore it from git.`);
  }
  if (parsed.version > 1) {
    throw new Error(
      `${file} was written by a newer Superwall CLI (lock version ${parsed.version}) — run \`superwall upgrade\`.`,
    );
  }
  if (parsed.version !== 1) {
    throw new Error(`${file} has an unknown lock version (${parsed.version}) — fix it or restore it from git.`);
  }
  return parsed;
}

export function readLock(superwallDir: string): LockFile {
  const file = lockPath(superwallDir);
  if (!fs.existsSync(file)) return emptyLock();
  const parsed = parseLockFile(file);
  const lock = emptyLock();
  if (isRecord(parsed.apps)) {
    for (const [platform, id] of Object.entries(parsed.apps)) {
      if (typeof id === "string") lock.apps[platform] = id;
    }
  }
  lock.paywalls = readSection(parsed.paywalls);
  lock.funnels = readSection(parsed.funnels);
  const origins = readOrigins(parsed.origins);
  if (origins) lock.origins = origins;
  const sources = parseSources(parsed.sources);
  if (Object.keys(sources).length > 0) lock.sources = sources;
  return lock;
}

export function formatLock(lock: LockFile): string {
  const annotated = {
    "//": EXPLAINER,
    version: lock.version,
    apps: lock.apps,
    paywalls: lock.paywalls,
    funnels: lock.funnels,
    ...(lock.origins && Object.keys(lock.origins).length > 0 ? { origins: lock.origins } : {}),
    ...(lock.sources && Object.keys(lock.sources).length > 0 ? { sources: lock.sources } : {}),
  };
  return `${JSON.stringify(annotated, null, 2)}\n`;
}

export function formatSharedLock(superwallDir: string): string {
  const { sources: _, ...lock } = readLock(superwallDir);
  return formatLock(lock);
}

function writeLock(superwallDir: string, lock: LockFile): void {
  const file = lockPath(superwallDir);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, formatLock(lock));
  fs.renameSync(temporary, file);
}

export function writeOrigin(
  superwallDir: string,
  kind: SurfaceKind,
  surfaceId: string,
  origin: SurfaceOrigin,
): void {
  const lock = readLock(superwallDir);
  lock.origins = { ...lock.origins, [originKey(kind, surfaceId)]: origin };
  writeLock(superwallDir, lock);
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
  pushed: PushedSnapshot,
): void {
  const lock = readLock(superwallDir);
  const section = sectionOf(lock, kind);
  const binding = section[surfaceId]?.[platform];
  if (!binding) return;
  if (binding.snapshot === pushed.snapshot && binding.sourcePending === pushed.sourcePending) return;
  section[surfaceId] = {
    ...section[surfaceId],
    [platform]:
      pushed.sourcePending === undefined
        ? { paywallId: binding.paywallId, snapshot: pushed.snapshot }
        : { paywallId: binding.paywallId, snapshot: pushed.snapshot, sourcePending: pushed.sourcePending },
  };
  writeLock(superwallDir, lock);
}

export function writeSources(superwallDir: string, sources: Record<string, string>): void {
  const lock = readLock(superwallDir);
  lock.sources = { ...lock.sources, ...sources };
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
