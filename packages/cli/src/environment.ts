import { join } from "node:path";
import { homedir } from "node:os";
import { version } from "../package.json";

export const VERSION = version;
export const DASHBOARD_URL = "https://superwall.com/dashboard";

export const ENV_API_KEY = "SUPERWALL_API_KEY";

export const CHANNELS = {
  latest: { skillsRef: "main" },
  next: { skillsRef: "next" },
} as const;

export type Channel = keyof typeof CHANNELS;

const isChannel = (value: string | undefined): value is Channel =>
  value !== undefined && value in CHANNELS;

export const CHANNEL = (): Channel => {
  const value = process.env.SUPERWALL_CHANNEL?.trim();
  return isChannel(value) ? value : "latest";
};

export const AGENT_SKILLS_DIR = (): string =>
  process.env.SUPERWALL_AGENT_SKILLS_DIR ?? join(homedir(), ".agents", "skills");

export const SUPERWALL_HOME = (): string | undefined => {
  const value = process.env.SUPERWALL_HOME;
  return value && value.trim() !== "" ? value.trim() : undefined;
};

const host = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
};

export const AUTH_HOST = (): string => host("SUPERWALL_AUTH_HOST", "https://auth.superwall.com");
export const ASSET_HOST = (): string =>
  host("SUPERWALL_ASSET_HOST", "https://user-content.superwalleditor.com/user-content/hl");
export const API_HOST = (): string => host("SUPERWALL_API_HOST", "https://api.superwall.com");
export const SDK_API_HOST = (): string => host("SUPERWALL_SDK_API_HOST", "https://api.superwall.me");
export const CLI_CLIENT_ID = (): string =>
  host("SUPERWALL_CLI_CLIENT_ID", "client_01KWEWM154D2T28NZAS02B8MWT");
export const OAUTH_SCOPE = "openid profile email offline_access";

export const TELEMETRY_HOST = (): string =>
  host("SUPERWALL_TELEMETRY_HOST", "https://us.i.posthog.com");
export const TELEMETRY_KEY = (): string =>
  host("SUPERWALL_TELEMETRY_KEY", "phc_obWpK8cuSfhNkZUKmDByATHp928RHPRD5DoMEDreAHS6");

export enum Integration {
  swift = "swift",
  android = "android",
  expo = "expo",
  reactNative = "react-native",
  flutter = "flutter",
  web = "web",
}

export function apiKeyFromEnv(): string | undefined {
  const v = process.env[ENV_API_KEY];
  return v && v.trim() ? v.trim() : undefined;
}

export function publicApiKeyFromEnv(): string | undefined {
  const v = process.env.SUPERWALL_PUBLIC_API_KEY;
  return v && v.trim() ? v.trim() : undefined;
}

export function isNonInteractive(): boolean {
  return !process.stdout.isTTY || !process.stdin.isTTY || process.env.CI === "true";
}
