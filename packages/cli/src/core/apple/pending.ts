import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SUPERWALL_HOME } from "@/environment";
import { formatJson } from "@/output";
import type { PendingVerification } from "./session";

const LIFETIME_MS = 10 * 60 * 1000;

interface Stored {
  savedAt: number;
  pending: PendingVerification;
}

function dir(): string {
  return SUPERWALL_HOME() ?? join(homedir(), ".superwall");
}
function file(): string {
  return join(dir(), "apple-sign-in.json");
}

export function savePending(pending: PendingVerification, now = Date.now()): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const stored: Stored = { savedAt: now, pending };
  writeFileSync(file(), `${formatJson(stored)}\n`, { mode: 0o600 });
}

export function loadPending(now = Date.now()): PendingVerification | undefined {
  try {
    if (!existsSync(file())) return undefined;
    const stored = JSON.parse(readFileSync(file(), "utf8")) as Stored;
    if (now - stored.savedAt > LIFETIME_MS) {
      clearPending();
      return undefined;
    }
    return stored.pending;
  } catch {
    return undefined;
  }
}

export function clearPending(): void {
  rmSync(file(), { force: true });
}
