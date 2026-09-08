import type { SuperwallBackgroundConfig } from "./background";
import type { SuperwallCheckoutConfig } from "./checkout";
import type { SuperwallLocalizationConfig } from "./localization";
import type { SuperwallNotificationsConfig } from "./notifications";
import type { SuperwallPresentationConfig } from "./presentation";
import type { SuperwallProductSlotInput } from "./products";

/**
 * A paywall's contract: product slots, presentation, gating, notifications,
 * and localization. The session reads it at render time and the build reads
 * it at push time.
 */
export type SuperwallConfig<TLocale extends string = string> = {
  /** Product slots this paywall renders, keyed by reference. Default: none. */
  products?: Record<string, SuperwallProductSlotInput>;

  /**
   * How a purchase completes on the web. Default: omitted, native-only —
   * nothing about checkout is bundled unless this asks for it.
   */
  checkout?: SuperwallCheckoutConfig;

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
   * Whether this paywall asks the SDK to dismiss it after a completed
   * purchase (`should_dismiss` on the purchase message). Default: `true`.
   * The app can still veto it with
   * `SuperwallOptions.paywalls.automaticallyDismiss = false`.
   */
  dismissOnPurchase?: boolean;

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
  checkoutModeOf,
  checkoutPrefetchOf,
  type SuperwallCheckoutConfig,
  type SuperwallCheckoutMode,
} from "./checkout";
export type { SuperwallLocalizationConfig, SuperwallMessages } from "./localization";
export type {
  SuperwallNotificationsConfig,
  SuperwallTrialReminderConfig,
  SuperwallTrialReminderContext,
  SuperwallTrialReminderNotification,
  SuperwallTrialReminderStaticConfig,
} from "./notifications";
export { normalizePlatform, SUPERWALL_PLATFORMS, type SuperwallPlatform } from "./platforms";
export type { SuperwallPresentationConfig, SuperwallPresentationStyle } from "./presentation";
export {
  isPlatformProductIds,
  productIdFor,
  type SuperwallPlatformProductIds,
  type SuperwallProductSlot,
  type SuperwallProductSlotInput,
} from "./products";
