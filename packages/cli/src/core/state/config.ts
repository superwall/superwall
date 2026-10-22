import { formatJson } from "@/program/output";
import { readJson, state } from "./store";

export interface SkillsSync {
  cliVersion: string;
  syncedAt: string;
  sourceSha?: string;
  ref?: string;
}

interface OnboardedApp {
  publicApiKey: string;
  projectId?: string;
  applicationId?: string;
}

interface Config {
  defaultApp?: Record<string, string>;
  openedOrgs?: string[];
  skillsSync?: SkillsSync;
  telemetry?: { anonymousId?: string; noticeShown?: boolean };
  onboardingIdempotencyKey?: string;
  onboarded?: {
    org?: { id: string; name: string };
    apps?: Record<string, OnboardedApp>;
  };
  updateCheck?: { latest?: string; checkedAt?: string };
}

const FILE = "config.json";

function read(): Config {
  return readJson<Config>(state(), FILE) ?? {};
}

function write(config: Config): void {
  state().write(FILE, `${formatJson(config)}\n`);
}

export function readDefaultApp(projectId: string): string | undefined {
  return read().defaultApp?.[projectId];
}

export function writeDefaultApp(projectId: string, applicationId: string): void {
  const config = read();
  config.defaultApp = {
    ...(config.defaultApp ?? {}),
    [projectId]: applicationId,
  };
  write(config);
}

export function readOpenedOrgs(): string[] {
  return read().openedOrgs ?? [];
}

export function writeOpenedOrgs(ids: readonly string[]): void {
  const config = read();
  const next = [...new Set(ids)];
  if (next.join() === (config.openedOrgs ?? []).join()) return;
  config.openedOrgs = next;
  write(config);
}

export function readSkillsSync(): SkillsSync | undefined {
  return read().skillsSync;
}

export function writeSkillsSync(sync: SkillsSync): void {
  const config = read();
  config.skillsSync = sync;
  write(config);
}

export function readAnonymousId(): string {
  const config = read();
  if (config.telemetry?.anonymousId) return config.telemetry.anonymousId;
  const anonymousId = crypto.randomUUID();
  config.telemetry = { ...config.telemetry, anonymousId };
  write(config);
  return anonymousId;
}

export function readOnboardedOrg(): { id: string; name: string } | undefined {
  return read().onboarded?.org;
}

export function writeOnboardedOrg(org: { id: string; name: string }): void {
  const config = read();
  config.onboarded = { ...config.onboarded, org };
  write(config);
}

export function readOnboardedApp(appPath: string): OnboardedApp | undefined {
  return read().onboarded?.apps?.[appPath];
}

export function writeOnboardedApp(appPath: string, app: OnboardedApp): void {
  const config = read();
  config.onboarded = {
    ...config.onboarded,
    apps: { ...config.onboarded?.apps, [appPath]: app },
  };
  write(config);
}

export function readUpdateCheck(): { latest?: string; checkedAt?: string } | undefined {
  return read().updateCheck;
}

export function writeUpdateCheck(check: { latest: string; checkedAt: string }): void {
  const config = read();
  config.updateCheck = check;
  write(config);
}

export function readOnboardingIdempotencyKey(): string {
  const config = read();
  if (config.onboardingIdempotencyKey) return config.onboardingIdempotencyKey;
  const key = crypto.randomUUID();
  config.onboardingIdempotencyKey = key;
  write(config);
  return key;
}

export function telemetryNoticeShown(): boolean {
  return Boolean(read().telemetry?.noticeShown);
}

export function writeTelemetryNoticeShown(): void {
  const config = read();
  config.telemetry = { ...config.telemetry, noticeShown: true };
  write(config);
}
