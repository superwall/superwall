import { afterEach, describe, expect, it, vi } from "vitest";
import { subscriptionsApiUrl } from "../../src/checkout/services/api";

const at = (href: string) => {
  vi.stubGlobal("window", {
    location: new URL(href),
    localStorage: { getItem: () => null },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscriptionsApiUrl", () => {
  it("routes a published paywall to the production subscriptions API", () => {
    at("https://user-content.superwalleditor.com/runtime/sha/x/headless/document/y.html");
    expect(subscriptionsApiUrl("checkout/session")).toBe(
      "https://subscriptions-api.superwall.com/subscriptions-api/public/v1/checkout/session",
    );
  });

  it("routes staging hosts to the staging subscriptions API", () => {
    at("https://pay.superwallbeta.app/x");
    expect(subscriptionsApiUrl("checkout/session/confirm")).toBe(
      "https://subscriptions-api.superwall.dev/subscriptions-api/public/v1/checkout/session/confirm",
    );
    at("https://pay.superwallapp.dev/x");
    expect(subscriptionsApiUrl("checkout/discount")).toContain("subscriptions-api.superwall.dev");
  });

  it("routes local development to the local subscriptions API", () => {
    at("http://localhost:6001/x");
    expect(subscriptionsApiUrl()).toBe(
      "http://localhost:3045/subscriptions-api/public/v1/checkout/session",
    );
  });

  it("honours an explicit environment override in the query string", () => {
    at("https://user-content.superwalleditor.com/x?sw_subscriptions_env=staging");
    expect(subscriptionsApiUrl()).toContain("subscriptions-api.superwall.dev");
  });
});
