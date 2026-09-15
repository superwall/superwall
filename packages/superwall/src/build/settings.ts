import {
  allowedHostsOf,
  backgroundOf,
  checkoutModeOf,
  LOOPBACK_HOST,
  MAX_ALLOWED_HOSTS,
  type SuperwallAllowedHostsConfig,
  type SuperwallCheckoutConfig,
  type SuperwallCheckoutMode,
  type SuperwallConfig,
  type SuperwallIntroductoryOfferEligibility,
  type SuperwallPresentationConfig,
} from "@superwall/runtime";

export type PaywallPresentationStyleWire =
  | { type: "FULLSCREEN" | "MODAL" | "PUSH" | "NO_ANIMATION" }
  | { type: "DRAWER"; height: number; corner_radius: number }
  | { type: "POPUP"; width: number; height: number; corner_radius: number };

export type WebCheckoutDestinationWire = "EXTERNAL" | "PAYWALL_EMBEDDED" | "PAYWALL_APPLE_PAY";

export type IntroductoryOfferEligibilityWire =
  | "automatic"
  | "always_eligible"
  | "always_ineligible";

export type PaywallSettings = {
  presentation_style: PaywallPresentationStyleWire;
  feature_gating: "gated" | "non_gated";
  on_device_cache: boolean;
  scroll_enabled: boolean;
  game_controller_enabled: boolean;
  introductory_offer_eligibility?: IntroductoryOfferEligibilityWire;
  web_checkout_destination?: WebCheckoutDestinationWire;
  background_color_hex?: string;
  dark_background_color_hex?: string;
  allowed_hosts?: string[];
};

const INTRODUCTORY_OFFER_WIRE: Record<
  SuperwallIntroductoryOfferEligibility,
  IntroductoryOfferEligibilityWire
> = {
  automatic: "automatic",
  eligible: "always_eligible",
  ineligible: "always_ineligible",
};

const DRAWER_DEFAULTS = { height: 70, cornerRadius: 15 };
const POPUP_DEFAULTS = { width: 80, height: 60, cornerRadius: 15 };

const DESTINATION_WIRE: Record<SuperwallCheckoutMode, WebCheckoutDestinationWire> = {
  external: "EXTERNAL",
  sheet: "PAYWALL_EMBEDDED",
  applePay: "PAYWALL_APPLE_PAY",
};

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

export const webCheckoutDestinationOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): WebCheckoutDestinationWire | undefined => {
  const mode = checkoutModeOf(checkout);
  return mode === undefined ? undefined : DESTINATION_WIRE[mode];
};

export const checkoutNeedsPaymentUi = (checkout: SuperwallCheckoutConfig | undefined): boolean => {
  const mode = checkoutModeOf(checkout);
  return mode === "sheet" || mode === "applePay";
};

export const allowedHostsWire = (
  allowedHosts: SuperwallAllowedHostsConfig | undefined,
): string[] | undefined => {
  const { origins, invalid } = allowedHostsOf(allowedHosts);

  const loopback = invalid.filter((entry) => LOOPBACK_HOST.test(entry.trim().toLowerCase()));
  if (loopback.length > 0) {
    throw new Error(
      `allowedHosts cannot name the loopback interface ` +
        `(${loopback.map((entry) => JSON.stringify(entry)).join(", ")}). ` +
        `A pushed paywall runs on a shopper's device, where localhost is their ` +
        `machine, not yours. \`superwall dev\` applies no policy at all, so a local ` +
        `API already works there without being named — and to reach one from a ` +
        `pushed build, put it behind an https tunnel and name that hostname.`,
    );
  }

  if (invalid.length > 0) {
    throw new Error(
      `allowedHosts must be bare hostnames over https, like "api.example.com" — ` +
        `could not read ${invalid.map((entry) => JSON.stringify(entry)).join(", ")}. ` +
        `Wildcards, paths and http:// are not accepted.`,
    );
  }
  if (origins.length > MAX_ALLOWED_HOSTS) {
    throw new Error(
      `allowedHosts names ${origins.length} hosts, more than the ${MAX_ALLOWED_HOSTS} allowed. ` +
        `Route the extra calls through one backend of your own.`,
    );
  }
  return origins.length === 0 ? undefined : origins;
};

export const paywallSettingsOf = (config: SuperwallConfig | undefined): PaywallSettings => {
  const background = backgroundOf(config?.background);
  const destination = webCheckoutDestinationOf(config?.checkout);
  const allowedHosts = allowedHostsWire(config?.allowedHosts);
  return {
    presentation_style: presentationStyleWire(config?.presentation),
    feature_gating: config?.featureGating === "gated" ? "gated" : "non_gated",
    on_device_cache: config?.onDeviceCacheEnabled ?? true,
    scroll_enabled: config?.scrollEnabled ?? true,
    game_controller_enabled: config?.gameControllerEnabled ?? false,
    ...(config?.introductoryOfferEligibility === undefined
      ? {}
      : {
          introductory_offer_eligibility:
            INTRODUCTORY_OFFER_WIRE[config.introductoryOfferEligibility],
        }),
    ...(destination === undefined ? {} : { web_checkout_destination: destination }),
    ...(background === undefined ? {} : { background_color_hex: background.light }),
    ...(background?.dark === undefined ? {} : { dark_background_color_hex: background.dark }),
    ...(allowedHosts === undefined ? {} : { allowed_hosts: allowedHosts }),
  };
};
