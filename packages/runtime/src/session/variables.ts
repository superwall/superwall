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
  simulatorModel?: string;
  deviceLocale?: string;
  preferredLocale?: string;
  deviceLanguageCode?: string;
  preferredLanguageCode?: string;
  regionCode?: string;
  preferredRegionCode?: string;
  deviceCurrencyCode?: string;
  deviceCurrencySymbol?: string;
  /**
   * The store's country, the key to switch a Stripe and a store slot on. The
   * iOS SDK reports the App Store storefront as ISO 3166-1 alpha-3 (`"USA"`);
   * the Android SDK (2.7.20 and later) reports the Play billing country as
   * alpha-2 (`"US"`). `undefined` on the web and on older SDKs.
   */
  storeFrontCountryCode?: string;
  /** The App Store storefront's identifier (`"143441"` for the US). iOS only. */
  storeFrontId?: string;
  /** The App Store storefront's currency, as ISO 4217 (`"USD"`). iOS 17 and later only. */
  storeFrontCurrency?: string;
  interfaceType?: string;
  interfaceStyle?: string;
  interfaceStyleMode?: string;
  timezoneOffset?: number;
  radioType?: string;
  fontSize?: number;
  fontScale?: number;
  preferredContentSizeCategory?: string;
  isLowPowerModeEnabled?: boolean;
  /**
   * @deprecated The native SDK always reports `true`, so this says nothing
   * about Apple Pay. To know whether Apple Pay is set up with a card, in the
   * app or on the web, use `useApplePay().available` or `checkApplePay()` from
   * `superwall/hooks`. In `checkout: "applePay"` mode Stripe's
   * `canMakePayment()` decides, reported by `useApplePay(product).product`.
   */
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
  safeAreaInsets?: SuperwallSafeAreaInsets;
};

export type SuperwallSafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
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
