import { afterEach, describe, expect, it } from "vitest";
import { bindsEntitlement, hostedInWebSdk } from "../../../src/checkout/host/surface";

type Holder = typeof window & { webPaywallCtrl?: { props?: { clientSurface?: unknown } } };

afterEach(() => {
  delete (window as Holder).webPaywallCtrl;
  window.history.replaceState(null, "", "/");
});

describe("hostedInWebSdk", () => {
  it("reads the web host's surface, then the iframe URL the SDK stamps", () => {
    expect(hostedInWebSdk()).toBe(false);
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-sdk" } };
    expect(hostedInWebSdk()).toBe(true);
    delete (window as Holder).webPaywallCtrl;
    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    expect(hostedInWebSdk()).toBe(true);
    window.history.replaceState(null, "", "/?client_surface=subdomain");
    expect(hostedInWebSdk()).toBe(false);
  });
});

describe("bindsEntitlement", () => {
  it("is true for the behaviors that self-claim, and for an unknown one", () => {
    expect(bindsEntitlement(undefined)).toBe(true);
    expect(bindsEntitlement("GRANT_ACCESS")).toBe(true);
    expect(bindsEntitlement("REDIRECT")).toBe(true);
    expect(bindsEntitlement("REDEEM")).toBe(false);
    expect(bindsEntitlement("CUSTOM")).toBe(false);
  });
});
