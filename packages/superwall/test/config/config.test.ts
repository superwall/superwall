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

describe("postPurchase narrows to what the platforms can act on", () => {
  it("allows the web values only where a web checkout can run", () => {
    definePaywall({ checkout: "sheet", postPurchase: "redeem" });
    definePaywall({
      checkout: "sheet",
      platforms: ["ios", "web"],
      postPurchase: { redirect: "https://x" },
    });
    definePaywall({ postPurchase: "stay" });
    definePaywall({ checkout: "sheet", platforms: ["ios"], postPurchase: "stay" });
    // @ts-expect-error — no checkout, nowhere to redeem
    definePaywall({ postPurchase: "redeem" });
    // @ts-expect-error — checkout declared, but this paywall never ships to the web
    definePaywall({ checkout: "sheet", platforms: ["ios", "android"], postPurchase: "redeem" });
    expect(true).toBe(true);
  });
});
