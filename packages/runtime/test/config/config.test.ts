import { describe, expect, it } from "vitest";
import {
  backgroundOf,
  checkoutModeOf,
  checkoutPrefetchOf,
  isPlatformProductIds,
  normalizePlatform,
  productIdFor,
} from "../../src/config";

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
    expect(normalizePlatform(undefined)).toBeUndefined();
  });
});

describe("checkout", () => {
  it("reads the mode from either form", () => {
    expect(checkoutModeOf("sheet")).toBe("sheet");
    expect(checkoutModeOf({ mode: "applePay" })).toBe("applePay");
    expect(checkoutModeOf(undefined)).toBeUndefined();
  });

  it("reads the prefetch steer from the object form only", () => {
    expect(checkoutPrefetchOf({ mode: "sheet", prefetch: "pro" })).toBe("pro");
    expect(checkoutPrefetchOf({ mode: "sheet", prefetch: false })).toBe(false);
    expect(checkoutPrefetchOf("sheet")).toBeUndefined();
    expect(checkoutPrefetchOf(undefined)).toBeUndefined();
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
