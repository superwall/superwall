import { describe, expect, it } from "vitest";
import {
  backgroundOf,
  defineSuperwallConfig,
  documentAttributes,
  isPlatformProductIds,
  normalizePlatform,
  normalizeProductSlot,
  paywallSettingsOf,
  presentationStyleWire,
  productIdFor,
  productsFromConfig,
  webCheckoutDestinationOf,
  checkoutNeedsPaymentUi,
  SUPERWALL_GENERATION,
} from "../src/config";

describe("normalizeProductSlot", () => {
  it("expands the string shorthand to a slot", () => {
    expect(normalizeProductSlot("pro_3999_year")).toEqual({ productId: "pro_3999_year" });
  });

  it("passes slot objects through", () => {
    expect(normalizeProductSlot({ productId: "pro" })).toEqual({ productId: "pro" });
    expect(normalizeProductSlot({})).toEqual({});
  });

  it("resolves a per-platform slot for the platform asked for", () => {
    const slot = { ios: "pro_year", android: "pro_year_play" };
    expect(normalizeProductSlot(slot, "android")).toEqual({ productId: "pro_year_play" });
    expect(normalizeProductSlot(slot, "ios")).toEqual({ productId: "pro_year" });
  });
});

describe("productIdFor", () => {
  const slot = { ios: "pro_year", android: "pro_year_play" };

  it("is the string itself, or the slot's productId, on every platform", () => {
    expect(productIdFor("pro", "android")).toBe("pro");
    expect(productIdFor({ productId: "pro" }, "web")).toBe("pro");
    expect(productIdFor({}, "ios")).toBeUndefined();
  });

  it("is nothing for a platform the per-platform slot does not name", () => {
    expect(productIdFor(slot, "web")).toBeUndefined();
  });

  it("falls back to the first entry when no platform is known", () => {
    expect(productIdFor(slot)).toBe("pro_year");
    expect(productIdFor({})).toBeUndefined();
  });

  it("tells per-platform slots apart from slot objects", () => {
    expect(isPlatformProductIds(slot)).toBe(true);
    expect(isPlatformProductIds({ productId: "x" })).toBe(false);
    expect(isPlatformProductIds("x")).toBe(false);
  });
});

describe("normalizePlatform", () => {
  it("maps what devices and the dashboard report onto ios, android, web", () => {
    expect(normalizePlatform("iOS")).toBe("ios");
    expect(normalizePlatform("Android")).toBe("android");
    expect(normalizePlatform("web")).toBe("web");
    expect(normalizePlatform("flutter")).toBeUndefined();
    expect(normalizePlatform("tvOS")).toBeUndefined();
    expect(normalizePlatform(undefined)).toBeUndefined();
  });
});

describe("productsFromConfig", () => {
  it("materializes slots as inline products with empty variables", () => {
    const config = defineSuperwallConfig({
      products: {
        primary: "pro_3999_year",
        secondary: { productId: "pro_999_month" },
        tertiary: {},
      },
    });

    const products = productsFromConfig(config);
    expect(products).toHaveLength(3);
    expect(products[0]).toEqual({
      reference: "primary",
      product: "primary",
      id: "pro_3999_year",
      productId: "pro_3999_year",
      productIdentifier: "pro_3999_year",
      variables: {},
      source: "inline",
    });
    expect(products[2]).toMatchObject({ reference: "tertiary", productId: undefined });
  });

  it("returns an empty list without config or products", () => {
    expect(productsFromConfig(undefined)).toEqual([]);
    expect(productsFromConfig({})).toEqual([]);
  });
});

describe("documentAttributes", () => {
  it("stamps the generation and defaults scroll to enabled", () => {
    expect(documentAttributes(undefined)).toEqual({
      "data-sw-generation": String(SUPERWALL_GENERATION),
      "data-sw-scroll": "true",
    });
    expect(documentAttributes({})).toMatchObject({ "data-sw-scroll": "true" });
  });

  it("reflects scrollEnabled from the config", () => {
    expect(documentAttributes({ scrollEnabled: false })).toMatchObject({
      "data-sw-scroll": "false",
    });
    expect(documentAttributes({ scrollEnabled: true })).toMatchObject({
      "data-sw-scroll": "true",
    });
  });
});

describe("checkoutNeedsPaymentUi", () => {
  it("asks for the payment UI only where payment happens in the page", () => {
    expect(checkoutNeedsPaymentUi("sheet")).toBe(true);
    expect(checkoutNeedsPaymentUi("applePay")).toBe(true);
  });

  it("leaves it out for external checkout, which only ever navigates away", () => {
    expect(checkoutNeedsPaymentUi("external")).toBe(false);
  });

  it("leaves it out when a paywall says nothing about checkout — the native default", () => {
    expect(checkoutNeedsPaymentUi(undefined)).toBe(false);
  });
});

describe("backgroundOf", () => {
  it("expands the string shorthand to a light color", () => {
    expect(backgroundOf("#000000")).toEqual({ light: "#000000" });
  });

  it("keeps a dark color when the object form supplies one", () => {
    expect(backgroundOf({ light: "#ffffff", dark: "#000000" })).toEqual({
      light: "#ffffff",
      dark: "#000000",
    });
  });

  it("drops an empty dark color rather than carrying a blank", () => {
    expect(backgroundOf({ light: "#fff", dark: "  " })).toEqual({ light: "#fff" });
  });

  it("is undefined when there is no usable light color", () => {
    expect(backgroundOf(undefined)).toBeUndefined();
    expect(backgroundOf("")).toBeUndefined();
    expect(backgroundOf({ light: "" })).toBeUndefined();
  });
});

describe("paywallSettingsOf", () => {
  it("defaults every setting the way an untouched editor paywall is stored", () => {
    expect(paywallSettingsOf(undefined)).toEqual({
      presentation_style: { type: "FULLSCREEN" },
      feature_gating: "non_gated",
      on_device_cache: true,
      scroll_enabled: true,
      game_controller_enabled: false,
      introductory_offer_eligibility: "automatic",
    });
    expect(paywallSettingsOf({})).toEqual(paywallSettingsOf(undefined));
  });

  it("maps every config key onto the API's wire values", () => {
    expect(
      paywallSettingsOf({
        presentation: { style: "modal" },
        featureGating: "gated",
        onDeviceCacheEnabled: false,
        scrollEnabled: false,
        gameControllerEnabled: true,
        introductoryOfferEligibility: "alwaysEligible",
      }),
    ).toEqual({
      presentation_style: { type: "MODAL" },
      feature_gating: "gated",
      on_device_cache: false,
      scroll_enabled: false,
      game_controller_enabled: true,
      introductory_offer_eligibility: "always_eligible",
    });
    expect(
      paywallSettingsOf({
        introductoryOfferEligibility: "alwaysIneligible",
        featureGating: "nonGated",
      }),
    ).toMatchObject({
      introductory_offer_eligibility: "always_ineligible",
      feature_gating: "non_gated",
    });
  });
});

describe("presentationStyleWire", () => {
  it("names each plain style the way the SDK reads it", () => {
    expect(presentationStyleWire({ style: "fullscreen" })).toEqual({ type: "FULLSCREEN" });
    expect(presentationStyleWire({ style: "modal" })).toEqual({ type: "MODAL" });
    expect(presentationStyleWire({ style: "push" })).toEqual({ type: "PUSH" });
    expect(presentationStyleWire({ style: "noAnimation" })).toEqual({ type: "NO_ANIMATION" });
    expect(presentationStyleWire(undefined)).toEqual({ type: "FULLSCREEN" });
  });

  it("carries drawer and popup geometry, with the editor's defaults when omitted", () => {
    expect(presentationStyleWire({ style: "drawer" })).toEqual({
      type: "DRAWER",
      height: 70,
      corner_radius: 15,
    });
    expect(
      presentationStyleWire({ style: "drawer", drawer: { height: 55, cornerRadius: 24 } }),
    ).toEqual({
      type: "DRAWER",
      height: 55,
      corner_radius: 24,
    });
    expect(presentationStyleWire({ style: "popup" })).toEqual({
      type: "POPUP",
      width: 80,
      height: 60,
      corner_radius: 15,
    });
    expect(
      presentationStyleWire({ style: "popup", popup: { width: 90, height: 50, cornerRadius: 8 } }),
    ).toEqual({ type: "POPUP", width: 90, height: 50, corner_radius: 8 });
  });

  it("ignores geometry for styles that have none", () => {
    expect(presentationStyleWire({ style: "modal", drawer: { height: 1 } })).toEqual({
      type: "MODAL",
    });
  });

  it("refuses geometry that cannot be laid out", () => {
    expect(() => presentationStyleWire({ style: "drawer", drawer: { height: 0 } })).toThrow(
      /presentation\.drawer\.height must be a positive number, got 0/,
    );
    expect(() => presentationStyleWire({ style: "popup", popup: { width: Number.NaN } })).toThrow(
      /presentation\.popup\.width/,
    );
    expect(() => presentationStyleWire({ style: "popup", popup: { cornerRadius: -1 } })).toThrow(
      /presentation\.popup\.cornerRadius/,
    );
  });
});

describe("paywallSettingsOf carries background and web checkout too", () => {
  it("includes the background and checkout destination only when the config sets them", () => {
    expect(paywallSettingsOf({ background: "#101828", checkout: "sheet" })).toMatchObject({
      background_color_hex: "#101828",
      web_checkout_destination: "PAYWALL_EMBEDDED",
    });
    expect(paywallSettingsOf({ background: { light: "#ffffff", dark: "#000000" } })).toMatchObject({
      background_color_hex: "#ffffff",
      dark_background_color_hex: "#000000",
    });
    const bare = paywallSettingsOf({});
    expect(bare).not.toHaveProperty("background_color_hex");
    expect(bare).not.toHaveProperty("dark_background_color_hex");
    expect(bare).not.toHaveProperty("web_checkout_destination");
  });

  it("maps every checkout mode to the API destination", () => {
    expect(webCheckoutDestinationOf("external")).toBe("EXTERNAL");
    expect(webCheckoutDestinationOf("sheet")).toBe("PAYWALL_EMBEDDED");
    expect(webCheckoutDestinationOf("applePay")).toBe("PAYWALL_APPLE_PAY");
    expect(webCheckoutDestinationOf({ mode: "applePay", prefetch: false })).toBe(
      "PAYWALL_APPLE_PAY",
    );
    expect(webCheckoutDestinationOf(undefined)).toBeUndefined();
  });

  it("drops a blank background rather than sending an empty hex", () => {
    expect(paywallSettingsOf({ background: "   " })).not.toHaveProperty("background_color_hex");
    expect(paywallSettingsOf({ background: { light: "#fff", dark: "  " } })).not.toHaveProperty(
      "dark_background_color_hex",
    );
  });

  it.each([
    ["fullscreen", { type: "FULLSCREEN" }],
    ["modal", { type: "MODAL" }],
    ["push", { type: "PUSH" }],
    ["noAnimation", { type: "NO_ANIMATION" }],
    ["drawer", { type: "DRAWER", height: 70, corner_radius: 15 }],
    ["popup", { type: "POPUP", width: 80, height: 60, corner_radius: 15 }],
  ] as const)("presentation style %s reaches the wire as %j", (style, wire) => {
    expect(paywallSettingsOf({ presentation: { style } }).presentation_style).toEqual(wire);
  });

  it.each([
    [{ featureGating: "gated" }, "gated"],
    [{ featureGating: "nonGated" }, "non_gated"],
    [{}, "non_gated"],
  ] as const)("feature gating %j → %s", (config, wire) => {
    expect(paywallSettingsOf(config).feature_gating).toBe(wire);
  });

  it("never emits a key the API does not know", () => {
    const keys = Object.keys(
      paywallSettingsOf({
        presentation: { style: "popup" },
        featureGating: "gated",
        onDeviceCacheEnabled: false,
        scrollEnabled: false,
        gameControllerEnabled: true,
        introductoryOfferEligibility: "alwaysEligible",
        background: { light: "#ffffff", dark: "#000000" },
        checkout: "external",
      }),
    ).sort();
    expect(keys).toEqual([
      "background_color_hex",
      "dark_background_color_hex",
      "feature_gating",
      "game_controller_enabled",
      "introductory_offer_eligibility",
      "on_device_cache",
      "presentation_style",
      "scroll_enabled",
      "web_checkout_destination",
    ]);
  });
});
