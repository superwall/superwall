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
  const value = resolveEnv("SUPERWALL_CHANNEL");
  return isChannel(value) ? value : "latest";
};


export const AUTH_HOST = (): string => resolveEnv("SUPERWALL_AUTH_HOST") ?? "https://auth.superwall.com";
export const ASSET_HOST = (): string =>
  resolveEnv("SUPERWALL_ASSET_HOST") ?? "https://user-content.superwalleditor.com/user-content/hl";
export const API_HOST_OVERRIDE = (): string | undefined => resolveEnv("SUPERWALL_API_HOST");
export const API_HOST = (): string => API_HOST_OVERRIDE() ?? "https://api.superwall.com";
export const CLI_CLIENT_ID = (): string =>
  resolveEnv("SUPERWALL_CLI_CLIENT_ID") ?? "client_01KWEWM154D2T28NZAS02B8MWT";
export const OAUTH_SCOPE = "openid profile email offline_access";

export const TELEMETRY_HOST = (): string =>
  resolveEnv("SUPERWALL_TELEMETRY_HOST") ?? "https://us.i.posthog.com";
export const TELEMETRY_KEY = (): string =>
  resolveEnv("SUPERWALL_TELEMETRY_KEY") ?? "phc_obWpK8cuSfhNkZUKmDByATHp928RHPRD5DoMEDreAHS6";

export enum Integration {
  swift = "swift",
  android = "android",
  expo = "expo",
  reactNative = "react-native",
  flutter = "flutter",
  web = "web",
}

export function apiKeyFromEnv(): string | undefined {
  return resolveEnv(ENV_API_KEY);
}

export const ENV_APPLE_ID = "SUPERWALL_APPLE_ID";
export const ENV_APPLE_PASSWORD = "SUPERWALL_APPLE_PASSWORD";

export function appleCredentialsFromEnv(): { appleId?: string; password?: string } {
  const appleId = resolveEnv(ENV_APPLE_ID);
  const password = process.env[ENV_APPLE_PASSWORD];
  return {
    ...(appleId ? { appleId } : {}),
    ...(password ? { password } : {}),
  };
}

const AGENT_ENV: [string, string][] = [
  ["CLAUDECODE", "claude-code"],
  ["CODEX_SANDBOX", "codex"],
  ["CURSOR_AGENT", "cursor"],
  ["GEMINI_CLI", "gemini-cli"],
];

// The MCP and hosted agents run the API client in a Worker, where Node's process may be absent.
export function detectAgent(
  env: NodeJS.ProcessEnv = typeof process === "undefined" ? {} : process.env,
): string | undefined {
  return AGENT_ENV.find(([key]) => env[key])?.[1];
}

// The API's audit log records it, so requests split by CLI version and by the agent driving the CLI.
export const USER_AGENT = (): string => {
  const agent = detectAgent();
  return agent ? `superwall-cli/${VERSION} (${agent})` : `superwall-cli/${VERSION}`;
};

export function resolveEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

export function isNonInteractive(): boolean {
  return !process.stdout.isTTY || !process.stdin.isTTY || process.env.CI === "true";
}

export const RUNNING_VIA_NPX = (): boolean => process.argv[1]?.includes("_npx") ?? false;
