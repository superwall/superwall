import { describe, expect, it } from "vitest";
import {
  bareProductIdentifier,
  isCustomStoreProductIdentifier,
  isStripeProductIdentifier,
} from "../../src/checkout/products";

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
    expect(bareProductIdentifier("custom|pro_monthly")).toBe("pro_monthly");
  });
});

describe("isCustomStoreProductIdentifier", () => {
  it("matches only custom store products", () => {
    expect(isCustomStoreProductIdentifier("custom|pro_monthly")).toBe(true);
    expect(isCustomStoreProductIdentifier("custom|")).toBe(false);
    expect(isCustomStoreProductIdentifier("stripe|test:price_1:no-trial")).toBe(false);
    expect(isCustomStoreProductIdentifier("pro_999_month")).toBe(false);
    expect(isCustomStoreProductIdentifier(undefined)).toBe(false);
  });
});
