import type { TIncomingMessageExperiment } from "@superwall/protocol";

export type SuperwallDeviceEntitlement = {
  identifier: string;
  type?: string;
  store?: string;
  state?: string;
  isActive?: boolean;
  isLifetime?: boolean;
  willRenew?: boolean;
  latestProductId?: string;
  productIds?: readonly string[];
  startsAt?: number;
  expiresAt?: number;
  renewedAt?: number;
};

export type SuperwallDeviceTransaction = {
  productId: string;
  transactionId?: string;
  subscriptionGroupId?: string;
  store?: string;
  isActive?: boolean;
  isRevoked?: boolean;
  isInGracePeriod?: boolean;
  isInBillingRetryPeriod?: boolean;
  willRenew?: boolean;
  purchaseDate?: number;
  expirationDate?: number;
};

export type SuperwallCustomerInfo = {
  entitlements?: readonly SuperwallDeviceEntitlement[];
  subscriptions?: readonly SuperwallDeviceTransaction[];
  nonSubscriptions?: readonly SuperwallDeviceTransaction[];
  isPlaceholder?: boolean;
};

export type SuperwallCapability = {
  name: string;
  eventNames?: readonly string[];
};

export type SuperwallDeviceVariables = {
  publicApiKey?: string;
  platform?: string;
  appUserId?: string;
  aliases?: readonly string[];
  vendorId?: string;
  deviceId?: string;
  appVersion?: string;
  appVersionPadded?: string;
  appBuildString?: string;
  appBuildStringNumber?: number;
  bundleId?: string;
  osVersion?: string;
  deviceModel?: string;
  deviceLocale?: string;
  preferredLocale?: string;
  deviceLanguageCode?: string;
  preferredLanguageCode?: string;
  regionCode?: string;
  preferredRegionCode?: string;
  deviceCurrencyCode?: string;
  deviceCurrencySymbol?: string;
  interfaceType?: string;
  interfaceStyle?: string;
  interfaceStyleMode?: string;
  timezoneOffset?: number;
  radioType?: string;
  fontSize?: number;
  fontScale?: number;
  preferredContentSizeCategory?: string;
  isLowPowerModeEnabled?: boolean;
  isApplePayAvailable?: boolean;
  isMac?: boolean;
  isSandbox?: string;
  isFirstAppOpen?: boolean;
  appInstallDate?: string;
  daysSinceInstall?: number;
  minutesSinceInstall?: number;
  daysSinceLastPaywallView?: number;
  minutesSinceLastPaywallView?: number;
  totalPaywallViews?: number;
  totalReviewRequests?: number;
  utcDate?: string;
  localDate?: string;
  utcTime?: string;
  localTime?: string;
  utcDateTime?: string;
  localDateTime?: string;
  subscriptionStatus?: string;
  activeEntitlements?: readonly string[];
  activeEntitlementObjects?: readonly SuperwallDeviceEntitlement[];
  activeProducts?: readonly string[];
  customerInfo?: SuperwallCustomerInfo;
  capabilitiesConfig?: readonly SuperwallCapability[];
  sdkVersion?: string;
  sdkVersionPadded?: string;
  capabilities?: string;
  platformWrapper?: string;
  platformWrapperVersion?: string;
  swiftVersion?: string;
  compilerVersion?: string;
  localResourceIds?: string;
};

export type SuperwallUserVariables = {
  seed?: number;
  appUserId?: string;
  aliasId?: string;
  applicationInstalledAt?: string;
} & Record<string, unknown>;

export type SuperwallPlacementParams = {
  $event_name?: string;
  event_name?: string;
  $is_standard_event?: boolean;
  $is_feature_gatable?: boolean;
  $app_session_id?: string;
} & Record<string, unknown>;

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
