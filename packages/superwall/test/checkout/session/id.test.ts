import { describe, expect, it } from "vitest";
import {
  buildCheckoutSessionId,
  decodeCheckoutSessionId,
  stripeEnvironmentOf,
} from "../../../src/checkout/session/id";

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

describe("decodeCheckoutSessionId of an id that is not URL-escaped", () => {
  it("keeps the Stripe id verbatim when it cannot be unescaped", () => {
    const id = buildCheckoutSessionId({ stripeCheckoutSessionId: "sub_100%", environment: "live" });
    expect(decodeCheckoutSessionId(id)).toBe("sub_100%");
  });

  it("unescapes one that is", () => {
    const id = buildCheckoutSessionId({
      stripeCheckoutSessionId: encodeURIComponent("sub_1 2"),
      environment: "live",
    });
    expect(decodeCheckoutSessionId(id)).toBe("sub_1 2");
  });

  it("rejects an id whose payload names an empty session", () => {
    expect(
      decodeCheckoutSessionId(
        `sw_checkout_${btoa(JSON.stringify({ stripeCheckoutSessionId: "" }))}`,
      ),
    ).toBeNull();
    expect(
      decodeCheckoutSessionId(
        `sw_checkout_${btoa(JSON.stringify({ stripeCheckoutSessionId: 7 }))}`,
      ),
    ).toBeNull();
    expect(decodeCheckoutSessionId(`sw_checkout_${btoa("null")}`)).toBeNull();
  });
});
