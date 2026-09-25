import { afterEach, describe, expect, it } from "vitest";
import type { SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { sdkHostsCheckoutInPaywall, sdkRedeemsCheckout } from "../../../src/checkout/host/sdk";

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

describe("inside the Web SDK", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("hosts the sheet and needs no redemption, whatever version the Web SDK reports", () => {
    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    expect(sdkHostsCheckoutInPaywall(on("000.002.009"))).toBe(true);
    expect(sdkRedeemsCheckout(on("000.002.009"))).toBe(true);
  });
});
