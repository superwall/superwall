import * as fs from "node:fs";
import * as path from "node:path";

export interface SurfaceBinding {
  paywallId: string;
}

const EXPLAINER =
  "Commit this file: it binds each paywall to its dashboard entry so every machine and CI push to the same place. Managed by the Superwall CLI.";

export interface LockFile {
  version: 1;
  applicationId?: string;
  paywalls: Record<string, SurfaceBinding>;
  funnels: Record<string, SurfaceBinding>;
}

const emptyLock = (): LockFile => ({ version: 1, paywalls: {}, funnels: {} });

const lockPath = (superwallDir: string) => path.join(superwallDir, "superwall.lock");

export function readLock(superwallDir: string): LockFile {
  const file = lockPath(superwallDir);
  if (!fs.existsSync(file)) return emptyLock();
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version === 1
    ) {
      const record = parsed as Partial<LockFile>;
      const lock = emptyLock();
      if (typeof record.applicationId === "string") lock.applicationId = record.applicationId;
      lock.paywalls = { ...record.paywalls };
      lock.funnels = { ...record.funnels };
      return lock;
    }
  } catch {
  }
  return emptyLock();
}

function writeLock(superwallDir: string, lock: LockFile): void {
  const annotated = { "//": EXPLAINER, ...lock };
  fs.writeFileSync(lockPath(superwallDir), `${JSON.stringify(annotated, null, 2)}\n`);
}

export function writeBinding(
  superwallDir: string,
  kind: "paywall" | "funnel",
  surfaceId: string,
  binding: SurfaceBinding,
): void {
  const lock = readLock(superwallDir);
  const section = kind === "paywall" ? lock.paywalls : lock.funnels;
  section[surfaceId] = binding;
  writeLock(superwallDir, lock);
}

export function removeBinding(
  superwallDir: string,
  kind: "paywall" | "funnel",
  surfaceId: string,
): boolean {
  const lock = readLock(superwallDir);
  const section = kind === "paywall" ? lock.paywalls : lock.funnels;
  if (!(surfaceId in section)) return false;
  delete section[surfaceId];
  writeLock(superwallDir, lock);
  return true;
}

export function writeApplicationId(superwallDir: string, applicationId: string): void {
  const lock = readLock(superwallDir);
  lock.applicationId = applicationId;
  writeLock(superwallDir, lock);
}
