import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SUPERWALL_HOME } from "@/environment";
import { formatJson } from "@/output";

export interface Session {
  authMethod?: "oauth" | "api_key";
  apiKey?: string;
  orgId?: string;
  orgName?: string;
  orgCount?: number;
  userEmail?: string;
  host: string;
  createdAt: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  tokenEndpoint?: string;
  oauthClientId?: string;
}

function dir(): string {
  return SUPERWALL_HOME() ?? join(homedir(), ".superwall");
}
function file(): string {
  return join(dir(), "auth.json");
}

export function saveSession(session: Session): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(file(), `${formatJson(session)}\n`, { mode: 0o600 });
}

export function loadSession(): Session | null {
  try {
    if (!existsSync(file())) return null;
    return JSON.parse(readFileSync(file(), "utf8")) as Session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    rmSync(file(), { force: true });
  } catch {
    /* ignore */
  }
}

function pendingFile(): string {
  return join(dir(), "pending-login.json");
}

export function savePendingLogin(pending: object): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(pendingFile(), `${formatJson(pending)}\n`, { mode: 0o600 });
}

export function loadPendingLogin<T>(): T | null {
  try {
    if (!existsSync(pendingFile())) return null;
    return JSON.parse(readFileSync(pendingFile(), "utf8")) as T;
  } catch {
    return null;
  }
}

export function clearPendingLogin(): void {
  rmSync(pendingFile(), { force: true });
}
