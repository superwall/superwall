import type { TIncomingMessageExperiment } from "@superwall/protocol";

/**
 * Device variables the native SDK delivers via `template_variables`.
 * All optional — availability depends on platform and SDK version.
 */
export type SuperwallDeviceVariables = {
  platform?: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  appBuildString?: string;
  bundleId?: string;
  locale?: string;
  languageCode?: string;
  regionCode?: string;
  preferredLocale?: string;
  preferredLanguage?: string;
  currencyCode?: string;
  currencySymbol?: string;
  timezoneOffset?: number;
  utcTime?: string;
  localTime?: string;
  interfaceStyle?: string;
  isLowPowerModeEnabled?: boolean | string;
  isSandbox?: boolean | string;
  isMac?: boolean;
  sdkVersion?: string;
  sdkVersionPadded?: string;
  publicApiKey?: string;
  appInstallDate?: string;
  daysSinceInstall?: number;
  totalPaywallViews?: number;
} & Record<string, unknown>;

/** User attributes the app set via the SDK (Superwall.shared.setUserAttributes). */
export type SuperwallUserVariables = Record<string, unknown>;

/** Parameters passed to the placement that presented this paywall. */
export type SuperwallPlacementParams = Record<string, unknown>;

/** Experiment assignment, mirroring the SDK's `experiment` message payload. */
export type SuperwallExperiment = Omit<TIncomingMessageExperiment, "event_name">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const recordFromVariables = (
  variables: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> => {
  const value = variables[key];
  return isRecord(value) ? value : {};
};
