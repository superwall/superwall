import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatJson } from "@/util/json";

export interface SkillsSync {
  cliVersion: string;
  syncedAt: string;
  sourceSha?: string;
}

export interface OnboardedApp {
  publicApiKey: string;
  projectId?: string;
  applicationId?: string;
}

interface Config {
  defaultApp?: Record<string, string>;
  skillsSync?: SkillsSync;
  telemetry?: { anonymousId?: string; noticeShown?: boolean };
  onboardingIdempotencyKey?: string;
  onboarded?: {
    org?: { id: string; name: string };
    apps?: Record<string, OnboardedApp>;
  };
  updateCheck?: { latest?: string; checkedAt?: string };
}

function dir(): string {
  return join(homedir(), ".superwall");
}
function file(): string {
  return join(dir(), "config.json");
}

function read(): Config {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as Config) : {};
  } catch {
    return {};
  }
}

function write(config: Config): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(file(), `${formatJson(config)}\n`, { mode: 0o600 });
}

export function getDefaultApp(projectId: string): string | undefined {
  return read().defaultApp?.[projectId];
}

export function setDefaultApp(projectId: string, applicationId: string): void {
  const config = read();
  config.defaultApp = {
    ...(config.defaultApp ?? {}),
    [projectId]: applicationId,
  };
  write(config);
}

export function getSkillsSync(): SkillsSync | undefined {
  return read().skillsSync;
}

export function setSkillsSync(sync: SkillsSync): void {
  const config = read();
  config.skillsSync = sync;
  write(config);
}

export function getAnonymousId(): string {
  const config = read();
  if (config.telemetry?.anonymousId) return config.telemetry.anonymousId;
  const anonymousId = randomUUID();
  config.telemetry = { ...config.telemetry, anonymousId };
  write(config);
  return anonymousId;
}

// Org membership and project listings lag for up to a minute after
// provisioning (server-side auth caching), so the CLI remembers what it
// created instead of re-asking the API.
export function getOnboardedOrg(): { id: string; name: string } | undefined {
  return read().onboarded?.org;
}

export function setOnboardedOrg(org: { id: string; name: string }): void {
  const config = read();
  config.onboarded = { ...config.onboarded, org };
  write(config);
}

export function getOnboardedApp(appPath: string): OnboardedApp | undefined {
  return read().onboarded?.apps?.[appPath];
}

export function setOnboardedApp(appPath: string, app: OnboardedApp): void {
  const config = read();
  config.onboarded = {
    ...config.onboarded,
    apps: { ...config.onboarded?.apps, [appPath]: app },
  };
  write(config);
}

export function getUpdateCheck(): { latest?: string; checkedAt?: string } | undefined {
  return read().updateCheck;
}

export function setUpdateCheck(check: { latest: string; checkedAt: string }): void {
  const config = read();
  config.updateCheck = check;
  write(config);
}

export function getOnboardingIdempotencyKey(): string {
  const config = read();
  if (config.onboardingIdempotencyKey) return config.onboardingIdempotencyKey;
  const key = randomUUID();
  config.onboardingIdempotencyKey = key;
  write(config);
  return key;
}

export function telemetryNoticeShown(): boolean {
  return Boolean(read().telemetry?.noticeShown);
}

export function setTelemetryNoticeShown(): void {
  const config = read();
  config.telemetry = { ...config.telemetry, noticeShown: true };
  write(config);
}
