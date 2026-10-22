import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUPERWALL_HOME } from "@/hosts/paths";
import { formatJson } from "@/program/output";
import type { PendingVerification } from "./session";

const LIFETIME_MS = 10 * 60 * 1000;

interface Stored {
  savedAt: number;
  pending: PendingVerification;
}

function dir(): string {
  return SUPERWALL_HOME();
}
function file(): string {
  return join(dir(), "apple-sign-in.json");
}

export function writePending(pending: PendingVerification, now = Date.now()): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const stored: Stored = { savedAt: now, pending };
  writeFileSync(file(), `${formatJson(stored)}\n`, { mode: 0o600 });
}

export function readPending(now = Date.now()): PendingVerification | undefined {
  try {
    if (!existsSync(file())) return undefined;
    const stored = JSON.parse(readFileSync(file(), "utf8")) as Stored;
    if (now - stored.savedAt > LIFETIME_MS) {
      removePending();
      return undefined;
    }
    return stored.pending;
  } catch {
    return undefined;
  }
}

export function removePending(): void {
  rmSync(file(), { force: true });
}
