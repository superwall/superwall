import * as fs from "node:fs";
import * as path from "node:path";

/**
 * `superwall.lock` — the committed binding between a project and the
 * dashboard: which Superwall app it belongs to, and which paywall each
 * surface (directory) pushes to. Written on first push so the whole team —
 * and CI — pushes to the same paywalls without configuring anything. No IDs
 * live in a project's config; the CLI owns every binding here.
 */

export interface SurfaceBinding {
  paywallId: string;
}

const EXPLAINER =
  "Commit this file: it binds each paywall to its dashboard entry so every machine and CI push to the same place. Managed by the Superwall CLI.";

export interface LockFile {
  version: 1;
  /** The Superwall application this project pushes to, once resolved. */
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
    // Corrupt lock — treat as unbound; the next push re-binds and rewrites it.
  }
  return emptyLock();
}

function writeLock(superwallDir: string, lock: LockFile): void {
  // JSON has no comments, so the explainer rides along as a "//" key —
  // read by people, ignored by readLock.
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

export function writeApplicationId(superwallDir: string, applicationId: string): void {
  const lock = readLock(superwallDir);
  lock.applicationId = applicationId;
  writeLock(superwallDir, lock);
}
