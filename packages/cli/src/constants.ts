import { version } from "../package.json";

export const VERSION = version;
export const DASHBOARD_URL = "https://superwall.com/dashboard";

export const ENV_API_KEY = "SUPERWALL_API_KEY";

export const AUTH_HOST = process.env.SUPERWALL_AUTH_HOST ?? "https://auth.superwall.com";
export const ASSET_HOST =
  process.env.SUPERWALL_ASSET_HOST ?? "https://user-content.superwalleditor.com/user-content/hl";
export const API_HOST = process.env.SUPERWALL_API_HOST ?? "https://api.superwall.com";
export const CLI_CLIENT_ID =
  process.env.SUPERWALL_CLI_CLIENT_ID ?? "client_01KWEWM154D2T28NZAS02B8MWT";
export const OAUTH_SCOPE = "openid profile email offline_access";

export const TELEMETRY_HOST = process.env.SUPERWALL_TELEMETRY_HOST ?? "https://us.i.posthog.com";
export const TELEMETRY_KEY =
  process.env.SUPERWALL_TELEMETRY_KEY ?? "phc_obWpK8cuSfhNkZUKmDByATHp928RHPRD5DoMEDreAHS6";

export enum Integration {
  swift = "swift",
  expo = "expo",
  reactNative = "react-native",
  flutter = "flutter",
  web = "web",
}
