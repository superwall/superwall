import { describe, expect, it } from "vitest";
import { attributeNames, PaywallElementSchema } from "../src/tags";

describe("PaywallElementSchema", () => {
  it.each([
    ["open-url", { "open-url": "https://superwall.com" }],
    ["open-url-external", { "open-url-external": "https://superwall.com" }],
    ["open-deep-link", { "open-deep-link": "myapp://home" }],
    ["close", { close: "" }],
    ["custom", { custom: "data" }],
    ["restore", { restore: "" }],
    ["var", { var: "primary.price" }],
    ["video", { video: "intro.mp4" }],
    ["container", { container: "hero" }],
    ["purchase", { purchase: "primary" }],
  ])("parses a %s element", (_kind, element) => {
    expect(PaywallElementSchema.parse(element)).toEqual(element);
  });

  it("rejects unknown elements", () => {
    expect(PaywallElementSchema.safeParse({ unknown: "x" }).success).toBe(false);
    expect(PaywallElementSchema.safeParse({}).success).toBe(false);
  });
});

describe("attributeNames", () => {
  it("lists every attribute-driven element", () => {
    expect(attributeNames).toEqual([
      "open-url",
      "open-url-external",
      "open-deep-link",
      "close",
      "restore",
      "var",
      "video",
      "purchase",
      "custom",
    ]);
  });
});
