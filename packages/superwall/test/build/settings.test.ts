import { describe, expect, it } from "vitest";
import {
  allowedHostsWire,
  checkoutNeedsPaymentUi,
  paywallSettingsOf,
  presentationStyleWire,
  webCheckoutDestinationOf,
} from "../../src/build/settings";
import { documentAttributes, SUPERWALL_GENERATION } from "../../src/document";

describe("documentAttributes", () => {
  it("stamps the generation and defaults scroll to enabled", () => {
    expect(documentAttributes(undefined)).toEqual({
      "data-sw-generation": String(SUPERWALL_GENERATION),
      "data-sw-scroll": "true",
      "data-sw-presentation": "fullscreen",
    });
    expect(documentAttributes({ scrollEnabled: false })).toMatchObject({
      "data-sw-scroll": "false",
    });
  });
});

describe("checkout wire", () => {
  it("asks for the payment UI only where payment happens in the page", () => {
    expect(checkoutNeedsPaymentUi("sheet")).toBe(true);
    expect(checkoutNeedsPaymentUi("applePay")).toBe(true);
    expect(checkoutNeedsPaymentUi("external")).toBe(false);
    expect(checkoutNeedsPaymentUi(undefined)).toBe(false);
  });

  it("maps every checkout mode to the API destination", () => {
    expect(webCheckoutDestinationOf("external")).toBe("EXTERNAL");
    expect(webCheckoutDestinationOf("sheet")).toBe("PAYWALL_EMBEDDED");
    expect(webCheckoutDestinationOf({ mode: "applePay", prefetch: false })).toBe(
      "PAYWALL_APPLE_PAY",
    );
    expect(webCheckoutDestinationOf(undefined)).toBeUndefined();
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
    ).toEqual({ type: "DRAWER", height: 55, corner_radius: 24 });
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

describe("allowedHostsWire", () => {
  it("sends nothing when the surface names no hosts", () => {
    expect(allowedHostsWire(undefined)).toBeUndefined();
    expect(allowedHostsWire([])).toBeUndefined();
  });

  it("sends normalized origins", () => {
    expect(allowedHostsWire(["api.example.com", "https://cdn.example.com/"])).toEqual([
      "https://api.example.com",
      "https://cdn.example.com",
    ]);
  });

  it("refuses the loopback interface with an explanation, not a typo hint", () => {
    for (const entry of ["localhost:3000", "http://localhost:3000", "127.0.0.1"]) {
      expect(() => allowedHostsWire([entry])).toThrow(/cannot name the loopback interface/);
    }
    expect(() => allowedHostsWire(["localhost:3000"])).toThrow(
      /`superwall dev` applies no policy at all/,
    );
  });

  it("only ever sends https origins", () => {
    expect(
      allowedHostsWire(["api.example.com", "https://cdn.example.com"])!.every((o) =>
        o.startsWith("https://"),
      ),
    ).toBe(true);
    expect(() => allowedHostsWire(["http://api.example.com"])).toThrow(
      /http:\/\/ are not accepted/,
    );
  });

  it("fails the push on a host it cannot read, naming the entry", () => {
    expect(() => allowedHostsWire(["*.example.com"])).toThrow(/"\*\.example\.com"/);
    expect(() => allowedHostsWire(["http://api.example.com"])).toThrow(
      /Wildcards, paths and http:\/\/ are not accepted/,
    );
  });

  it("fails the push when more hosts are named than the cap allows", () => {
    const hosts = Array.from({ length: 21 }, (_, index) => `h${index}.example.com`);
    expect(() => allowedHostsWire(hosts)).toThrow(/names 21 hosts, more than the 20 allowed/);
  });

  it("counts the cap after deduping", () => {
    const hosts = Array.from({ length: 21 }, () => "api.example.com");
    expect(allowedHostsWire(hosts)).toEqual(["https://api.example.com"]);
  });
});

describe("paywallSettingsOf", () => {
  it("carries allowed hosts onto the wire, and omits the key when there are none", () => {
    expect(paywallSettingsOf({ allowedHosts: ["api.example.com"] })).toMatchObject({
      allowed_hosts: ["https://api.example.com"],
    });
    expect(paywallSettingsOf({})).not.toHaveProperty("allowed_hosts");
    expect(paywallSettingsOf({ allowedHosts: [] })).not.toHaveProperty("allowed_hosts");
  });

  it("stamps the introductory-offer override only when the config sets one", () => {
    expect(paywallSettingsOf({ introductoryOfferEligibility: "eligible" })).toMatchObject({
      introductory_offer_eligibility: "always_eligible",
    });
    expect(paywallSettingsOf({ introductoryOfferEligibility: "ineligible" })).toMatchObject({
      introductory_offer_eligibility: "always_ineligible",
    });
    expect(paywallSettingsOf({ introductoryOfferEligibility: "automatic" })).toMatchObject({
      introductory_offer_eligibility: "automatic",
    });
    expect(paywallSettingsOf({})).not.toHaveProperty("introductory_offer_eligibility");
  });

  it("defaults every setting the way an untouched editor paywall is stored", () => {
    expect(paywallSettingsOf(undefined)).toEqual({
      presentation_style: { type: "FULLSCREEN" },
      feature_gating: "non_gated",
      on_device_cache: true,
      scroll_enabled: true,
      game_controller_enabled: false,
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
      }),
    ).toEqual({
      presentation_style: { type: "MODAL" },
      feature_gating: "gated",
      on_device_cache: false,
      scroll_enabled: false,
      game_controller_enabled: true,
    });
    expect(paywallSettingsOf({ featureGating: "nonGated" })).toMatchObject({
      feature_gating: "non_gated",
    });
  });

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

  it("never emits a key the API does not know", () => {
    const keys = Object.keys(
      paywallSettingsOf({
        presentation: { style: "popup" },
        featureGating: "gated",
        onDeviceCacheEnabled: false,
        scrollEnabled: false,
        gameControllerEnabled: true,
        background: { light: "#ffffff", dark: "#000000" },
        checkout: "external",
      }),
    ).toSorted();
    expect(keys).toEqual([
      "background_color_hex",
      "dark_background_color_hex",
      "feature_gating",
      "game_controller_enabled",
      "on_device_cache",
      "presentation_style",
      "scroll_enabled",
      "web_checkout_destination",
    ]);
  });
});
