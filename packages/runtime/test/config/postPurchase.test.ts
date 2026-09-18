import { describe, expect, it } from "vitest";
import { dismissesOnPurchase } from "../../src/config";

describe("dismissesOnPurchase", () => {
  it("dismisses for everything but stay, and defers to the SDK when unset", () => {
    expect(dismissesOnPurchase("dismiss")).toBe(true);
    expect(dismissesOnPurchase("redeem")).toBe(true);
    expect(dismissesOnPurchase({ redirect: "https://x" })).toBe(true);
    expect(dismissesOnPurchase("stay")).toBe(false);
    expect(dismissesOnPurchase(undefined)).toBeUndefined();
  });
});
