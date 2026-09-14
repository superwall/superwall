import type { SuperwallBackgroundConfig } from "./background";
import type { SuperwallCheckoutConfig } from "./checkout";
import type { SuperwallInsetsConfig } from "./insets";
import type { SuperwallLocalizationConfig } from "./localization";
import type { SuperwallNotificationsConfig } from "./notifications";
import type { SuperwallPresentationConfig } from "./presentation";
import type { SuperwallPostPurchase } from "./postPurchase";
import type { SuperwallProductSlotInput } from "./products";

export type SuperwallIntroductoryOfferEligibility = "automatic" | "eligible" | "ineligible";

/**
 * A paywall's contract: product slots, presentation, gating, notifications,
 * and localization. The session reads it at render time and the build reads
 * it at push time.
 */
export type SuperwallConfig<
  TLocale extends string = string,
  TStripeReference extends string = string,
> = {
  /** Product slots this paywall renders, keyed by reference. Default: none. */
  products?: Record<string, SuperwallProductSlotInput>;

  /**
   * How a purchase completes on the web. Default: omitted, native-only —
   * nothing about checkout is bundled unless this asks for it.
   */
  checkout?: SuperwallCheckoutConfig<TStripeReference>;

  /**
   * How the native SDK presents the paywall: style and drawer/popup
   * geometry. Default: `{ style: "fullscreen" }`.
   */
  presentation?: SuperwallPresentationConfig;

  /**
   * Background color painted behind the paywall while it loads and as the web
   * document background. String shorthand = light mode; `{ light, dark }` adds
   * a dark-mode color. Default: the platform default.
   */
  background?: SuperwallBackgroundConfig;

  /**
   * What every page is padded with: `"safe-area"` (the device's safe area,
   * floored per platform and presentation), `"none"`, pixels, a CSS length,
   * or one value per edge. Chrome that sits over the bars on purpose reads
   * `--sw-safe-area-inset-*` instead. Default: `"safe-area"`.
   */
  insets?: SuperwallInsetsConfig;

  /**
   * Whether the feature behind the placement is gated on a purchase.
   * Default: `"nonGated"`.
   */
  featureGating?: "gated" | "nonGated";

  /** Forward game controller input to the paywall. Default: `false`. */
  gameControllerEnabled?: boolean;

  /** Whether the webview scrolls. Default: `true`. */
  scrollEnabled?: boolean;

  /** Cache the paywall on device for instant presentation. Default: `true`. */
  onDeviceCacheEnabled?: boolean;

  /**
   * How the SDK decides introductory-offer (trial) eligibility for this
   * paywall's products: `"automatic"` asks the store, `"eligible"` and
   * `"ineligible"` force the answer — useful to preview or ship the one
   * variant regardless of the shopper's history. Default: `"automatic"`.
   */
  introductoryOfferEligibility?: SuperwallIntroductoryOfferEligibility;

  /**
   * What happens once a purchase completes: `"dismiss"` (default), `"stay"`
   * to keep the paywall in control, and on the web also `"redeem"` or
   * `{ redirect: url }`. See `SuperwallPostPurchase`. A `purchase()` call can
   * override it per button.
   */
  postPurchase?: SuperwallPostPurchase;

  /**
   * Local notifications the paywall schedules (e.g. trial reminders).
   * Default: none.
   */
  notifications?: SuperwallNotificationsConfig;

  /**
   * Message catalogs and the fallback locale for `t()`. Default:
   * `{ defaultLocale: "en" }`; file-based catalogs need no config.
   */
  localization?: SuperwallLocalizationConfig<TLocale>;
};

export {
  backgroundOf,
  type ResolvedBackground,
  type SuperwallBackgroundConfig,
} from "./background";
export {
  checkoutManagedPaymentsOf,
  checkoutModeOf,
  checkoutPrefetchOf,
  type SuperwallCheckoutConfig,
  type SuperwallCheckoutMode,
  type SuperwallManagedPaymentsOverride,
} from "./checkout";
export {
  INSET_EDGES,
  insetsOf,
  type InsetEdge,
  type ResolvedInsets,
  type SuperwallInsetSide,
  type SuperwallInsetsConfig,
} from "./insets";
export type { SuperwallLocalizationConfig, SuperwallMessages } from "./localization";
export type {
  SuperwallNotificationsConfig,
  SuperwallTrialReminderConfig,
  SuperwallTrialReminderContext,
  SuperwallTrialReminderNotification,
  SuperwallTrialReminderStaticConfig,
} from "./notifications";
export { normalizePlatform, SUPERWALL_PLATFORMS, type SuperwallPlatform } from "./platforms";
export { dismissesOnPurchase, type SuperwallPostPurchase } from "./postPurchase";
export type { SuperwallPresentationConfig, SuperwallPresentationStyle } from "./presentation";
export {
  isPlatformProductIds,
  productIdFor,
  type SuperwallPlatformProductIds,
  type SuperwallProductSlot,
  type SuperwallProductSlotInput,
} from "./products";
