import { describe, expect, it } from "vitest";
import {
  buildCheckoutSessionId,
  decodeCheckoutSessionId,
  stripeEnvironmentOf,
} from "../../src/checkout/utils/checkoutSessionId";

describe("checkout session ids", () => {
  it("round-trips a Stripe id through the opaque wrapper", () => {
    const id = buildCheckoutSessionId({ stripeCheckoutSessionId: "sub_123", environment: "test" });
    expect(id.startsWith("sw_checkout_")).toBe(true);
    expect(decodeCheckoutSessionId(id)).toBe("sub_123");
  });

  it("uses base64url so the id survives a query string", () => {
    const id = buildCheckoutSessionId({ stripeCheckoutSessionId: "??>>", environment: "live" });
    expect(id).not.toMatch(/[+/=]/);
    expect(decodeCheckoutSessionId(id)).toBe("??>>");
  });

  it("rejects values that are not ours", () => {
    expect(decodeCheckoutSessionId("cs_test_plain")).toBeNull();
    expect(decodeCheckoutSessionId("sw_checkout_not-json")).toBeNull();
    expect(decodeCheckoutSessionId(`sw_checkout_${btoa(JSON.stringify({}))}`)).toBeNull();
  });

  it("reads the Stripe environment off a product identifier", () => {
    expect(stripeEnvironmentOf("test:price_1:no-trial")).toBe("test");
    expect(stripeEnvironmentOf("stripe|test:price_1:no-trial")).toBe("test");
    expect(stripeEnvironmentOf("live:price_1:no-trial")).toBe("live");
    expect(stripeEnvironmentOf(undefined)).toBe("live");
  });
});
