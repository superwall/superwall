import type { SuperwallProduct } from "./products";

/**
 * A product slot the paywall renders, keyed by reference in
 * `SuperwallConfig["products"]`. Product data (price, period, trial…) is
 * SDK-owned and arrives at runtime; the mock host synthesizes it in dev.
 */
export type SuperwallProductSlot = {
  /** Store product identifier this slot maps to (e.g. "pro_3999_year"). */
  productId?: string;
};

/** A slot object, or the store product identifier as shorthand. */
export type SuperwallProductSlotInput = string | SuperwallProductSlot;

export type SuperwallPresentationConfig = {
  /** How the native SDK presents the paywall. Defaults to "fullscreen". */
  style?: "fullscreen" | "modal" | "push" | "drawer" | "popup" | "noAnimation";
  /** Required when style is "drawer". */
  drawer?: { height: number; cornerRadius: number };
  /** Required when style is "popup". */
  popup?: { width: number; height: number; cornerRadius: number };
};

export type SuperwallTrialReminderStaticConfig = {
  enabled?: boolean;
  /** Notification title. Localizable: message keys resolve through `t()`. */
  title: string;
  subtitle?: string;
  /** Notification body. Localizable: message keys resolve through `t()`. */
  body: string;
  /** How many days before the trial ends the reminder fires. Defaults to 1. */
  beforeTrialEndDays?: number;
};

/** Context passed to a dynamic trial reminder function. */
export type SuperwallTrialReminderContext = {
  /** When the trial ends, per the SDK. */
  trialEndDate: Date;
  /** Store identifier of the purchased product, when the SDK provides it. */
  productIdentifier?: string;
  /** The matching product, when it's one of this paywall's slots. */
  product?: SuperwallProduct;
  /** Translator for the active locale. */
  t: (key: string, values?: Record<string, string | number>) => string;
  locale: string;
};

/** What a dynamic trial reminder resolves to. */
export type SuperwallTrialReminderNotification = {
  title: string;
  subtitle?: string;
  body: string;
  /** Milliseconds from now until the notification fires. */
  delayMs: number;
};

/**
 * Static config, or a function computing the notification from the trial
 * context (schedule time, localized copy, per-product logic). Return null
 * from the function to skip scheduling.
 */
export type SuperwallTrialReminderConfig =
  | SuperwallTrialReminderStaticConfig
  | ((
      context: SuperwallTrialReminderContext,
    ) => SuperwallTrialReminderNotification | null | undefined);

export type SuperwallNotificationsConfig = {
  /** Auto-scheduled when the SDK reports a trial started (`freeTrial_start`). */
  trialReminder?: SuperwallTrialReminderConfig;
};

/**
 * Nested message catalog for one locale. Values interpolate `{name}` params:
 * `{ paywall: { title: "Unlock {appName}" } }` → `t("paywall.title", { appName })`.
 */
export type SuperwallMessages = { [key: string]: string | SuperwallMessages };

export type SuperwallLocalizationConfig<TLocale extends string = string> = {
  /** Locale used when the device locale has no catalog. */
  defaultLocale: TLocale;
  /** Message catalogs by locale (e.g. `{ en, de, "pt-BR": ptBR }`). */
  messages?: Record<TLocale, SuperwallMessages> & Record<string, SuperwallMessages>;
};

/**
 * How a purchase completes on the web. Native hosts ignore it — they always
 * buy through the store.
 *
 * - `external` — leave for Superwall's hosted checkout page and come back.
 * - `sheet` — take payment in the paywall, in a sheet Superwall renders.
 * - `applePay` — go straight to Apple Pay, falling back to the sheet where
 *   Apple Pay is unavailable.
 *
 * The sheet's appearance is fixed and takes nothing from the paywall around
 * it. Payment UI that borrows a paywall's fonts and colors stops looking like
 * payment UI, which is the one place a shopper is entitled to see something
 * they recognize.
 *
 * `sheet` and `applePay` carry Stripe's payment UI into the bundle; `external`
 * costs nothing. Read this before shipping either:
 * https://superwall.com/docs/web-checkout
 */
export type SuperwallCheckoutMode = "external" | "sheet" | "applePay";

export type SuperwallCheckoutConfig =
  | SuperwallCheckoutMode
  | { mode: SuperwallCheckoutMode; prefetch?: string | false };

export const checkoutModeOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): SuperwallCheckoutMode | undefined => (typeof checkout === "string" ? checkout : checkout?.mode);

export const checkoutPrefetchOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): string | false | undefined => (typeof checkout === "object" ? checkout.prefetch : undefined);

export type SuperwallConfig<TLocale extends string = string> = {
  /** Product slots this paywall renders, keyed by reference. */
  products?: Record<string, SuperwallProductSlotInput>;

  /**
   * How a purchase completes on the web. Omit it for native-only paywalls —
   * nothing about checkout is bundled unless this asks for it.
   */
  checkout?: SuperwallCheckoutConfig;

  /** How and when the native SDK presents the paywall. */
  presentation?: SuperwallPresentationConfig;

  /** Whether users must pay to pass this paywall. Defaults to "nonGated". */
  featureGating?: "gated" | "nonGated";

  /** Trial eligibility handling. Defaults to "automatic" (SDK decides). */
  introductoryOfferEligibility?: "automatic" | "alwaysEligible" | "alwaysIneligible";

  /** Forward game controller input to the paywall. */
  gameControllerEnabled?: boolean;

  /** Whether the webview scrolls. Defaults to true. */
  scrollEnabled?: boolean;

  /** Cache the paywall on device. Defaults to true. */
  onDeviceCacheEnabled?: boolean;

  /** Use Superwall-managed payments where available. */
  managedPayments?: boolean;

  /** Dismiss the paywall automatically after a completed purchase. */
  dismissOnPurchase?: boolean;

  /** Resolve pending purchases as failed after this many ms without a transaction. */
  purchaseTimeoutMs?: number;

  /** Local notifications the paywall schedules (e.g. trial reminders). */
  notifications?: SuperwallNotificationsConfig;

  /** Message catalogs and default locale for `t()`. */
  localization?: SuperwallLocalizationConfig<TLocale>;
};

/**
 * Declares the paywall's contract: product slots, presentation, gating,
 * notifications, and localization. Consumed by the runtime session at render
 * time and by the Superwall build pipeline at push time.
 */
export const defineSuperwallConfig = <TLocale extends string = string>(
  config: SuperwallConfig<TLocale>,
) => config;

export const normalizeProductSlot = (input: SuperwallProductSlotInput): SuperwallProductSlot =>
  typeof input === "string" ? { productId: input } : input;

export const checkoutNeedsPaymentUi = (checkout: SuperwallCheckoutConfig | undefined): boolean => {
  const mode = checkoutModeOf(checkout);
  return mode === "sheet" || mode === "applePay";
};

/**
 * Materializes the config's product slots as products so references exist
 * before the SDK (or mock host) delivers real product data.
 */
export const productsFromConfig = (config: SuperwallConfig | undefined): SuperwallProduct[] =>
  Object.entries(config?.products ?? {}).map(([reference, input]) => {
    const slot = normalizeProductSlot(input);
    return {
      reference,
      product: reference,
      id: slot.productId,
      productId: slot.productId,
      productIdentifier: slot.productId,
      variables: {},
      source: "inline",
    };
  });

/** @deprecated Use `SuperwallConfig`. */
export type SuperwallPaywallConfig<TLocale extends string = string> = SuperwallConfig<TLocale>;

/** The framework's paywall generation — v4 is the visual editor, v5 is code. */
export const SUPERWALL_GENERATION = 5;

/**
 * Document semantics as `<html>` data attributes — the snapshot's half of the
 * two-layer contract. The build stamps these statically (no flash before
 * hydration) and `SuperwallProvider` reasserts them at runtime (dev has no
 * build step). The platform's serve-time stylesheet (live.css) owns what they
 * mean, so their interpretation can evolve fleet-wide without republishing.
 */
export const documentAttributes = (
  config: SuperwallConfig | undefined,
): Record<string, string> => ({
  "data-sw-generation": String(SUPERWALL_GENERATION),
  "data-sw-scroll": String(config?.scrollEnabled ?? true),
});
