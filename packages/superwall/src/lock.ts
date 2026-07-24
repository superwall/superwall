import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Read-only view of `superwall.lock` — the committed binding between this
 * project and the dashboard (which app it belongs to, which paywall each
 * surface pushes to). The CLI owns writing it (`superwall push` binds on
 * first push); the framework only reads it, e.g. so the studio can show
 * which dashboard paywall a surface is bound to.
 */

export type SurfaceBinding = {
  paywallId: string;
};

export type LockFile = {
  version: 1;
  /** The Superwall application this project pushes to, once resolved. */
  applicationId?: string;
  paywalls: Record<string, SurfaceBinding>;
  funnels: Record<string, SurfaceBinding>;
};

const emptyLock = (): LockFile => ({ version: 1, paywalls: {}, funnels: {} });

export const readLock = (superwallDir: string): LockFile => {
  const file = path.join(superwallDir, "superwall.lock");
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
    // Corrupt lock — treat as unbound; the CLI re-binds and rewrites it.
  }
  return emptyLock();
};
