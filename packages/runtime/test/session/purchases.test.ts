import { describe, expect, it } from "vitest";
import { createSuperwallProduct } from "../../src/products";
import { createPurchaseTracker } from "../../src/session/purchases";

const primary = createSuperwallProduct({ reference: "primary", productId: "pro_year" });
const secondary = createSuperwallProduct({ reference: "secondary", productId: "pro_month" });

describe("createPurchaseTracker", () => {
  it("hands a pending purchase to whoever settles the transaction", async () => {
    const tracker = createPurchaseTracker();
    const result = tracker.begin(primary);

    const pending = tracker.take({ product: "primary" });
    expect(pending?.product).toBe(primary);
    pending?.resolve({
      status: "abandoned",
      product: primary,
      message: { event_name: "transaction_abandon" },
    });

    await expect(result).resolves.toMatchObject({ status: "abandoned" });
    expect(tracker.find({ product: "primary" })).toBeUndefined();
  });

  it("supersedes an earlier purchase of the same product", async () => {
    const tracker = createPurchaseTracker();
    const first = tracker.begin(primary);
    const second = tracker.begin(primary);

    await expect(first).resolves.toEqual({
      status: "failed",
      product: primary,
      reason: "superseded",
    });
    expect(tracker.find({ product: "primary" })).toBeDefined();
    void second;
  });

  it("fails one or every pending purchase on demand", async () => {
    const tracker = createPurchaseTracker();
    const first = tracker.begin(primary);
    const second = tracker.begin(secondary);

    expect(tracker.fail("missing", "sdk")).toBeUndefined();
    expect(tracker.fail("primary", "sdk")).toMatchObject({ reason: "sdk" });
    tracker.failAll("superseded");

    await expect(first).resolves.toMatchObject({ reason: "sdk" });
    await expect(second).resolves.toMatchObject({ reason: "superseded" });
  });

  it("attributes transactions by reference, then store id, then the only pending one", () => {
    const tracker = createPurchaseTracker();
    tracker.begin(primary);

    expect(tracker.find({ product: "primary" })?.product).toBe(primary);
    expect(tracker.find({ product_identifier: "pro_year" })?.product).toBe(primary);
    expect(tracker.find({ product_identifier: "other" })).toBeUndefined();
    expect(tracker.find({})?.product).toBe(primary);

    tracker.begin(secondary);
    expect(tracker.find({})).toBeUndefined();
    expect(tracker.take({ product: "nope" })).toBeUndefined();
  });
});
