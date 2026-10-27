import { afterEach, describe, expect, it } from "vitest";
import type { SuperwallRuntimeSnapshot } from "@superwall/runtime";
import {
  checkoutModeFor,
  sdkHostsCheckoutInPaywall,
  sdkRedeemsCheckout,
} from "../../../src/checkout/host/sdk";

const on = (sdkVersionPadded?: string): SuperwallRuntimeSnapshot =>
  ({ device: sdkVersionPadded === undefined ? {} : { sdkVersionPadded } }) as never;

describe("sdkHostsCheckoutInPaywall", () => {
  it("is true from 4.10.8, and for a host that reports no version", () => {
    expect(sdkHostsCheckoutInPaywall(on("004.010.008"))).toBe(true);
    expect(sdkHostsCheckoutInPaywall(on("004.014.000"))).toBe(true);
    expect(sdkHostsCheckoutInPaywall(on("005.000.000"))).toBe(true);
    expect(sdkHostsCheckoutInPaywall(on())).toBe(true);
  });

  it("is false below it, so an old SDK gets the hosted page", () => {
    expect(sdkHostsCheckoutInPaywall(on("004.010.007"))).toBe(false);
    expect(sdkHostsCheckoutInPaywall(on("004.009.000"))).toBe(false);
    expect(sdkHostsCheckoutInPaywall(on("003.999.999"))).toBe(false);
  });
});

describe("sdkRedeemsCheckout", () => {
  it("is true from 4.14.0 only", () => {
    expect(sdkRedeemsCheckout(on("004.014.000"))).toBe(true);
    expect(sdkRedeemsCheckout(on("004.014.001"))).toBe(true);
    expect(sdkRedeemsCheckout(on("005.000.000"))).toBe(true);
  });

  it("is false below it, and for a host that reports no version", () => {
    expect(sdkRedeemsCheckout(on("004.013.999"))).toBe(false);
    expect(sdkRedeemsCheckout(on("004.010.008"))).toBe(false);
    expect(sdkRedeemsCheckout(on())).toBe(false);
  });
});

const app = (
  platform: string,
  checkout?: "sheet" | "applePay" | "external",
): SuperwallRuntimeSnapshot =>
  ({ device: { platform, sdkVersionPadded: "004.017.000" }, config: { checkout } }) as never;

describe("checkoutModeFor", () => {
  it("is always the hosted page inside an iOS app, whatever the paywall asks for", () => {
    expect(checkoutModeFor(app("iOS", "sheet"))).toBe("external");
    expect(checkoutModeFor(app("iOS", "applePay"))).toBe("external");
    expect(checkoutModeFor(app("iOS"), "sheet")).toBe("external");
  });

  it("keeps the configured mode elsewhere, and is the hosted page when none is configured", () => {
    expect(checkoutModeFor(app("Android", "sheet"))).toBe("sheet");
    expect(checkoutModeFor(app("web", "applePay"))).toBe("applePay");
    expect(checkoutModeFor(app("Android"))).toBe("external");
    expect(checkoutModeFor(app("Android", "sheet"), "applePay")).toBe("applePay");
  });

  it("opens a per-call sheet or wallet only where the paywall ships the payment UI", () => {
    expect(checkoutModeFor(app("Android", "external"), "sheet")).toBe("external");
    expect(checkoutModeFor(app("Android"), "applePay")).toBe("external");
    expect(checkoutModeFor(app("Android", "applePay"), "sheet")).toBe("sheet");
    expect(checkoutModeFor(app("Android", "sheet"), "external")).toBe("external");
  });

  it("is the hosted page for an SDK too old to host payment", () => {
    expect(
      checkoutModeFor({
        device: { platform: "Android", sdkVersionPadded: "004.010.007" },
        config: { checkout: "sheet" },
      } as never),
    ).toBe("external");
  });
});

describe("checkoutModeFor on the web half of a teleport", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__SW_TELEPORT__");
  });

  it("pays in the page, never on the hosted page, whatever the app's device", () => {
    Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout" });
    expect(checkoutModeFor(app("iOS", "sheet"))).toBe("sheet");
    expect(checkoutModeFor(app("iOS", "applePay"))).toBe("applePay");
    expect(checkoutModeFor(app("iOS", "external"))).toBe("applePay");
    expect(checkoutModeFor(app("iOS"))).toBe("applePay");
  });

  it("lets one purchase pick the sheet or the wallet there, never the hosted page", () => {
    Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout" });
    expect(checkoutModeFor(app("iOS", "applePay"), "sheet")).toBe("sheet");
    expect(checkoutModeFor(app("iOS", "sheet"), "external")).toBe("applePay");
  });
});

describe("inside the Web SDK", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("hosts the sheet and needs no redemption, whatever version the Web SDK reports", () => {
    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    expect(sdkHostsCheckoutInPaywall(on("000.002.009"))).toBe(true);
    expect(sdkRedeemsCheckout(on("000.002.009"))).toBe(true);
  });

  it("keeps the configured mode even when the shopper's device is an iPhone", () => {
    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    expect(checkoutModeFor(app("iOS", "sheet"))).toBe("sheet");
  });
});
