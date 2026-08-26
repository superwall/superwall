import { describe, expect, it } from "vitest";
import {
  backgroundOf,
  defineSuperwallConfig,
  documentAttributes,
  isPlatformProductIds,
  normalizePlatform,
  normalizeProductSlot,
  productIdFor,
  productsFromConfig,
  checkoutNeedsPaymentUi,
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

  it("resolves a per-platform slot for the platform asked for", () => {
    const slot = { ios: "pro_year", android: "pro_year_play" };
    expect(normalizeProductSlot(slot, "android")).toEqual({ productId: "pro_year_play" });
    expect(normalizeProductSlot(slot, "ios")).toEqual({ productId: "pro_year" });
  });
});

describe("productIdFor", () => {
  const slot = { ios: "pro_year", android: "pro_year_play" };

  it("is the string itself, or the slot's productId, on every platform", () => {
    expect(productIdFor("pro", "android")).toBe("pro");
    expect(productIdFor({ productId: "pro" }, "web")).toBe("pro");
    expect(productIdFor({}, "ios")).toBeUndefined();
  });

  it("is nothing for a platform the per-platform slot does not name", () => {
    expect(productIdFor(slot, "web")).toBeUndefined();
  });

  it("falls back to the first entry when no platform is known", () => {
    expect(productIdFor(slot)).toBe("pro_year");
    expect(productIdFor({})).toBeUndefined();
  });

  it("tells per-platform slots apart from slot objects", () => {
    expect(isPlatformProductIds(slot)).toBe(true);
    expect(isPlatformProductIds({ productId: "x" })).toBe(false);
    expect(isPlatformProductIds("x")).toBe(false);
  });
});

describe("normalizePlatform", () => {
  it("maps what devices and the dashboard report onto ios, android, web", () => {
    expect(normalizePlatform("iOS")).toBe("ios");
    expect(normalizePlatform("Android")).toBe("android");
    expect(normalizePlatform("web")).toBe("web");
    expect(normalizePlatform("flutter")).toBeUndefined();
    expect(normalizePlatform("tvOS")).toBeUndefined();
    expect(normalizePlatform(undefined)).toBeUndefined();
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

describe("checkoutNeedsPaymentUi", () => {
  it("asks for the payment UI only where payment happens in the page", () => {
    expect(checkoutNeedsPaymentUi("sheet")).toBe(true);
    expect(checkoutNeedsPaymentUi("applePay")).toBe(true);
  });

  it("leaves it out for external checkout, which only ever navigates away", () => {
    expect(checkoutNeedsPaymentUi("external")).toBe(false);
  });

  it("leaves it out when a paywall says nothing about checkout — the native default", () => {
    expect(checkoutNeedsPaymentUi(undefined)).toBe(false);
  });
});

describe("backgroundOf", () => {
  it("expands the string shorthand to a light color", () => {
    expect(backgroundOf("#000000")).toEqual({ light: "#000000" });
  });

  it("keeps a dark color when the object form supplies one", () => {
    expect(backgroundOf({ light: "#ffffff", dark: "#000000" })).toEqual({
      light: "#ffffff",
      dark: "#000000",
    });
  });

  it("drops an empty dark color rather than carrying a blank", () => {
    expect(backgroundOf({ light: "#fff", dark: "  " })).toEqual({ light: "#fff" });
  });

  it("is undefined when there is no usable light color", () => {
    expect(backgroundOf(undefined)).toBeUndefined();
    expect(backgroundOf("")).toBeUndefined();
    expect(backgroundOf({ light: "" })).toBeUndefined();
  });
});
