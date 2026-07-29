import { describe, expect, it } from "vitest";
import { definePaywall } from "../../src/config";
import { mergeMessages } from "../../src/internal";

describe("mergeMessages", () => {
  it("deep-merges catalogs with later keys winning", () => {
    const merged = mergeMessages(
      { paywall: { title: "Go Pro", cta: "Buy" }, footer: "Legal" },
      { paywall: { title: "Go Plus" } },
    );
    expect(merged).toEqual({ paywall: { title: "Go Plus", cta: "Buy" }, footer: "Legal" });
  });

  it("replaces when shapes disagree and tolerates undefined", () => {
    expect(mergeMessages({ a: { deep: "x" } }, { a: "flat" })).toEqual({ a: "flat" });
    expect(mergeMessages(undefined, undefined)).toEqual({});
  });
});

describe("definePaywall", () => {
  it("passes the definition through unchanged (an identity contract)", () => {
    const paywall = definePaywall({ featureGating: "gated", products: { go: "sku_go" } });
    expect(paywall.featureGating).toBe("gated");
    expect(paywall.products).toEqual({ go: "sku_go" });
  });
});
