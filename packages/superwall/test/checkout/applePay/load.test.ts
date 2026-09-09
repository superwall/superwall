import { describe, expect, it, vi } from "vitest";

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(async () => null),
}));

const { loadStripe } = await import("@stripe/stripe-js");
const { createApplePay } = await import("../../../src/checkout/applePay");
const { hostEvents } = await import("../../../src/checkout/host");

describe("a controller with no Stripe loader injected", () => {
  it("loads Stripe.js the way the paywall does in a browser", async () => {
    const controller = createApplePay({
      publicApiKey: () => "pk_public",
      host: hostEvents(vi.fn()),
    });

    await controller.prepare({
      directive: "elements",
      checkoutSessionId: null,
      publishableKey: "pk_test_live",
      checkoutContextId: "ctx_1",
      referenceName: "primary",
      subscriptionDetails: { amount: 1999, currency: "usd", interval: "month", intervalCount: 1 },
    });

    expect(loadStripe).toHaveBeenCalledWith("pk_test_live", {
      developerTools: { assistant: { enabled: false } },
    });
    expect(controller.availability("primary")).toEqual({
      status: "unavailable",
      reason: "stripe_js_load_failed",
    });
  });
});
