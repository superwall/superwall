import { describe, expect, it } from "vitest";
import {
  defineSuperwallConfig,
  documentAttributes,
  normalizeProductSlot,
  productsFromConfig,
  SUPERWALL_GENERATION,
} from "../src/config";

describe("normalizeProductSlot", () => {
  it("expands the string shorthand to a slot", () => {
    expect(normalizeProductSlot("pro_3999_year")).toEqual({ productId: "pro_3999_year" });
  });

  it("passes slot objects through", () => {
    expect(normalizeProductSlot({ productId: "pro" })).toEqual({ productId: "pro" });
    expect(normalizeProductSlot({})).toEqual({});
  });
});

describe("productsFromConfig", () => {
  it("materializes slots as inline products with empty variables", () => {
    const config = defineSuperwallConfig({
      products: {
        primary: "pro_3999_year",
        secondary: { productId: "pro_999_month" },
        tertiary: {},
      },
    });

    const products = productsFromConfig(config);
    expect(products).toHaveLength(3);
    expect(products[0]).toEqual({
      reference: "primary",
      product: "primary",
      id: "pro_3999_year",
      productId: "pro_3999_year",
      productIdentifier: "pro_3999_year",
      variables: {},
      source: "inline",
    });
    expect(products[2]).toMatchObject({ reference: "tertiary", productId: undefined });
  });

  it("returns an empty list without config or products", () => {
    expect(productsFromConfig(undefined)).toEqual([]);
    expect(productsFromConfig({})).toEqual([]);
  });
});

describe("documentAttributes", () => {
  it("stamps the generation and defaults scroll to enabled", () => {
    expect(documentAttributes(undefined)).toEqual({
      "data-sw-generation": String(SUPERWALL_GENERATION),
      "data-sw-scroll": "true",
    });
    expect(documentAttributes({})).toMatchObject({ "data-sw-scroll": "true" });
  });

  it("reflects scrollEnabled from the config", () => {
    expect(documentAttributes({ scrollEnabled: false })).toMatchObject({
      "data-sw-scroll": "false",
    });
    expect(documentAttributes({ scrollEnabled: true })).toMatchObject({
      "data-sw-scroll": "true",
    });
  });
});
