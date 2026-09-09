import { describe, expect, it } from "vitest";
import { bareProductIdentifier, isStripeProductIdentifier } from "../../src/checkout/products";

describe("isStripeProductIdentifier", () => {
  it("matches bare and store-prefixed stripe composites, rejects store ids", () => {
    expect(isStripeProductIdentifier("test:price_1:no-trial")).toBe(true);
    expect(isStripeProductIdentifier("live:price_1:trial")).toBe(true);
    expect(isStripeProductIdentifier("stripe|test:price_1:no-trial")).toBe(true);
    expect(isStripeProductIdentifier("pro_999_month")).toBe(false);
    expect(isStripeProductIdentifier(undefined)).toBe(false);
  });
});

describe("bareProductIdentifier", () => {
  it("drops the store prefix and leaves a bare identifier alone", () => {
    expect(bareProductIdentifier("stripe|test:price_1:no-trial")).toBe("test:price_1:no-trial");
    expect(bareProductIdentifier("test:price_1:no-trial")).toBe("test:price_1:no-trial");
  });
});
