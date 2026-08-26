import type { SuperwallProduct } from "./products";

export const SUPERWALL_PLATFORMS = ["ios", "android", "web"] as const;

export type SuperwallPlatform = (typeof SUPERWALL_PLATFORMS)[number];

export const normalizePlatform = (value: string | undefined): SuperwallPlatform | undefined => {
  const normalized = (value ?? "").toLowerCase();
  return SUPERWALL_PLATFORMS.find((platform) => platform === normalized);
};

/**
 * A product slot the paywall renders, keyed by reference in
 * `SuperwallConfig["products"]`. Product data (price, period, trial…) is
 * SDK-owned and arrives at runtime; the mock host synthesizes it in dev.
 */
export type SuperwallProductSlot = {
  /** Store product identifier this slot maps to (e.g. "pro_3999_year"). */
  productId?: string;
};

/**
 * One store identifier per platform the paywall ships to, for a slot whose
 * underlying product differs by store — the same `purchase("annual")` buys
 * the App Store product on iOS and the Play product on Android.
 */
export type SuperwallPlatformProductIds = Partial<Record<SuperwallPlatform, string>>;

/**
 * A slot object, the store product identifier as shorthand, or one
 * identifier per platform.
 */
export type SuperwallProductSlotInput = string | SuperwallProductSlot | SuperwallPlatformProductIds;

export const isPlatformProductIds = (
  input: SuperwallProductSlotInput,
): input is SuperwallPlatformProductIds =>
  typeof input === "object" && input !== null && !("productId" in input);

/**
 * The store identifier a slot resolves to on a platform. A per-platform slot
 * with no entry for the platform resolves to nothing; with no platform known
 * at all it falls back to its first entry.
 */
export const productIdFor = (
  input: SuperwallProductSlotInput,
  platform?: SuperwallPlatform,
): string | undefined => {
  if (typeof input === "string") return input;
  if (!isPlatformProductIds(input)) return input.productId;
  if (platform !== undefined) return input[platform];
  return Object.values(input).find((id) => typeof id === "string");
};

export type SuperwallPresentationStyle =
  | "fullscreen"
  | "modal"
  | "push"
  | "drawer"
  | "popup"
  | "noAnimation";

export type SuperwallPresentationConfig = {
  /** How the native SDK presents the paywall. Defaults to "fullscreen". */
  style?: SuperwallPresentationStyle;
  /**
   * Drawer geometry, as percentages of the screen and points. Only read when
   * style is "drawer"; defaults to 70% height with a 15pt corner radius.
   */
  drawer?: { height?: number; cornerRadius?: number };
  /**
   * Popup geometry, as percentages of the screen and points. Only read when
   * style is "popup"; defaults to 80% × 60% with a 15pt corner radius.
   */
  popup?: { width?: number; height?: number; cornerRadius?: number };
};

export type PaywallPresentationStyleWire =
  | { type: "FULLSCREEN" | "MODAL" | "PUSH" | "NO_ANIMATION" }
  | { type: "DRAWER"; height: number; corner_radius: number }
  | { type: "POPUP"; width: number; height: number; corner_radius: number };

export type WebCheckoutDestinationWire = "EXTERNAL" | "PAYWALL_EMBEDDED" | "PAYWALL_APPLE_PAY";

export type PaywallSettings = {
  presentation_style: PaywallPresentationStyleWire;
  feature_gating: "gated" | "non_gated";
  on_device_cache: boolean;
  scroll_enabled: boolean;
  game_controller_enabled: boolean;
  introductory_offer_eligibility: "automatic" | "always_eligible" | "always_ineligible";
  web_checkout_destination?: WebCheckoutDestinationWire;
  background_color_hex?: string;
  dark_background_color_hex?: string;
};

const DRAWER_DEFAULTS = { height: 70, cornerRadius: 15 };
const POPUP_DEFAULTS = { width: 80, height: 60, cornerRadius: 15 };

const dimension = (label: string, value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`presentation.${label} must be a positive number, got ${String(value)}`);
  }
  return resolved;
};

export const presentationStyleWire = (
  presentation: SuperwallPresentationConfig | undefined,
): PaywallPresentationStyleWire => {
  switch (presentation?.style ?? "fullscreen") {
    case "fullscreen":
      return { type: "FULLSCREEN" };
    case "modal":
      return { type: "MODAL" };
    case "push":
      return { type: "PUSH" };
    case "noAnimation":
      return { type: "NO_ANIMATION" };
    case "drawer":
      return {
        type: "DRAWER",
        height: dimension("drawer.height", presentation?.drawer?.height, DRAWER_DEFAULTS.height),
        corner_radius: dimension(
          "drawer.cornerRadius",
          presentation?.drawer?.cornerRadius,
          DRAWER_DEFAULTS.cornerRadius,
        ),
      };
    case "popup":
      return {
        type: "POPUP",
        width: dimension("popup.width", presentation?.popup?.width, POPUP_DEFAULTS.width),
        height: dimension("popup.height", presentation?.popup?.height, POPUP_DEFAULTS.height),
        corner_radius: dimension(
          "popup.cornerRadius",
          presentation?.popup?.cornerRadius,
          POPUP_DEFAULTS.cornerRadius,
        ),
      };
  }
};

const ELIGIBILITY_WIRE = {
  automatic: "automatic",
  alwaysEligible: "always_eligible",
  alwaysIneligible: "always_ineligible",
} as const;

const CHECKOUT_WIRE: Record<SuperwallCheckoutMode, WebCheckoutDestinationWire> = {
  external: "EXTERNAL",
  sheet: "PAYWALL_EMBEDDED",
  applePay: "PAYWALL_APPLE_PAY",
};

export const webCheckoutDestinationOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): WebCheckoutDestinationWire | undefined => {
  const mode = checkoutModeOf(checkout);
  return mode === undefined ? undefined : CHECKOUT_WIRE[mode];
};

export const paywallSettingsOf = (config: SuperwallConfig | undefined): PaywallSettings => {
  const background = backgroundOf(config?.background);
  const destination = webCheckoutDestinationOf(config?.checkout);
  return {
    presentation_style: presentationStyleWire(config?.presentation),
    feature_gating: config?.featureGating === "gated" ? "gated" : "non_gated",
    on_device_cache: config?.onDeviceCacheEnabled ?? true,
    scroll_enabled: config?.scrollEnabled ?? true,
    game_controller_enabled: config?.gameControllerEnabled ?? false,
    introductory_offer_eligibility:
      ELIGIBILITY_WIRE[config?.introductoryOfferEligibility ?? "automatic"],
    ...(destination === undefined ? {} : { web_checkout_destination: destination }),
    ...(background === undefined ? {} : { background_color_hex: background.light }),
    ...(background?.dark === undefined ? {} : { dark_background_color_hex: background.dark }),
  };
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

/**
 * A paywall's background color. The string shorthand sets light mode; the
 * object form adds a dark-mode color. Native SDKs paint it behind the webview
 * (and derive the loading spinner from it), and the web document paints it as
 * the page background — so the color a shopper sees while the paywall loads
 * matches the color it settles on.
 */
export type SuperwallBackgroundConfig = string | { light: string; dark?: string };

export type ResolvedBackground = { light: string; dark?: string };

export const backgroundOf = (
  background: SuperwallBackgroundConfig | undefined,
): ResolvedBackground | undefined => {
  if (background === undefined) return undefined;
  if (typeof background === "string") {
    const light = background.trim();
    return light === "" ? undefined : { light };
  }
  const light = background.light?.trim();
  if (!light) return undefined;
  const dark = background.dark?.trim();
  return dark ? { light, dark } : { light };
};

export type SuperwallConfig<TLocale extends string = string> = {
  /** Product slots this paywall renders, keyed by reference. */
  products?: Record<string, SuperwallProductSlotInput>;

  /**
   * How a purchase completes on the web. Omit it for native-only paywalls —
   * nothing about checkout is bundled unless this asks for it.
   */
  checkout?: SuperwallCheckoutConfig;

  /** How the native SDK presents the paywall: style and drawer/popup geometry. */
  presentation?: SuperwallPresentationConfig;

  /**
   * Background color painted behind the paywall while it loads and as the web
   * document background. String shorthand = light mode; `{ light, dark }` adds
   * a dark-mode color.
   */
  background?: SuperwallBackgroundConfig;

  /**
   * Whether the feature behind the placement is gated on a purchase.
   * Defaults to "nonGated".
   */
  featureGating?: "gated" | "nonGated";

  /** Trial eligibility handling. Defaults to "automatic" (SDK decides). */
  introductoryOfferEligibility?: "automatic" | "alwaysEligible" | "alwaysIneligible";

  /** Forward game controller input to the paywall. Defaults to false. */
  gameControllerEnabled?: boolean;

  /** Whether the webview scrolls. Defaults to true. */
  scrollEnabled?: boolean;

  /** Cache the paywall on device for instant presentation. Defaults to true. */
  onDeviceCacheEnabled?: boolean;

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

export const normalizeProductSlot = (
  input: SuperwallProductSlotInput,
  platform?: SuperwallPlatform,
): SuperwallProductSlot => ({ productId: productIdFor(input, platform) });

export const checkoutNeedsPaymentUi = (checkout: SuperwallCheckoutConfig | undefined): boolean => {
  const mode = checkoutModeOf(checkout);
  return mode === "sheet" || mode === "applePay";
};

/**
 * Materializes the config's product slots as products so references exist
 * before the SDK (or mock host) delivers real product data.
 */
export const productsFromConfig = (
  config: SuperwallConfig | undefined,
  platform?: SuperwallPlatform,
): SuperwallProduct[] =>
  Object.entries(config?.products ?? {}).map(([reference, input]) => {
    const slot = normalizeProductSlot(input, platform);
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
