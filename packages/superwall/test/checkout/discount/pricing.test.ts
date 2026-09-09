import { describe, expect, it } from "vitest";
import { discountedProductsFor } from "../../../src/checkout/discount/pricing";

const price = {
  productIdentifier: "test:price_1:no-trial",
  applies: true,
  originalAmount: 1999,
  discountedAmount: 1499,
  currency: "usd",
};

const product = {
  reference: "primary",
  productId: "test:price_1:no-trial",
  variables: {},
  source: "sdk" as const,
};

describe("discountedProductsFor", () => {
  it("prices a product both ways and states what the code saves", () => {
    expect(discountedProductsFor([product], [price], "en").primary).toEqual({
      reference: "primary",
      applies: true,
      currency: "usd",
      amount: 1999,
      discountedAmount: 1499,
      savings: 500,
      price: "$19.99",
      discountedPrice: "$14.99",
      savingsPrice: "$5",
    });
  });

  it("never reports a negative saving, however the backend priced it", () => {
    const inverted = { ...price, originalAmount: 999, discountedAmount: 1999 };
    expect(discountedProductsFor([product], [inverted], "en").primary?.savings).toBe(0);
  });

  it("skips a product the store has no id for", () => {
    expect(
      discountedProductsFor(
        [{ reference: "placeholder", variables: {}, source: "sdk" }],
        [price],
        "en",
      ),
    ).toEqual({});
  });

  it("matches a store-prefixed identifier to its bare price", () => {
    const prefixed = { ...product, productId: "stripe|test:price_1:no-trial" };
    expect(discountedProductsFor([prefixed], [price], "en").primary?.discountedPrice).toBe(
      "$14.99",
    );
  });

  it("formats for the paywall's locale", () => {
    const euros = { ...price, currency: "eur" };
    expect(discountedProductsFor([product], [euros], "de-DE").primary?.price).toContain("19,99");
  });
});
