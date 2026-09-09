import { describe, expect, it, vi } from "vitest";
import { createDiscountStore } from "../../../src/checkout/discount/store";

describe("the discount store", () => {
  const discount = { code: "SAVE5", promotionCodeId: "p", couponId: "c" };
  const prices = [
    {
      productIdentifier: "test:price_1",
      applies: true,
      originalAmount: 1,
      discountedAmount: 0,
      currency: "usd",
    },
    {
      productIdentifier: "test:price_2",
      applies: false,
      originalAmount: 1,
      discountedAmount: 1,
      currency: "usd",
    },
  ];

  it("answers a code only for products it applies to", () => {
    const store = createDiscountStore();
    expect(store.codeFor("test:price_1")).toBeNull();
    store.apply("SAVE5", discount, prices);
    expect(store.codeFor("stripe|test:price_1")).toBe("SAVE5");
    expect(store.codeFor("test:price_2")).toBeNull();
  });

  it("reports whether clearing changed anything, and notifies only then", () => {
    const store = createDiscountStore();
    const changed = vi.fn();
    store.subscribe(changed);
    expect(store.clear()).toBe(false);
    expect(changed).not.toHaveBeenCalled();

    store.apply("SAVE5", discount, prices);
    expect(store.clear()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(store.applied).toBeNull();
  });

  it("tells dropped listeners which code went, and unsubscribes cleanly", () => {
    const store = createDiscountStore();
    const dropped = vi.fn();
    const changed = vi.fn();
    const stopDropped = store.subscribeDropped(dropped);
    const stopChanged = store.subscribe(changed);
    store.apply("SAVE5", discount, prices);
    store.drop("SAVE5");
    expect(dropped).toHaveBeenCalledWith("SAVE5");
    expect(store.applied).toBeNull();

    stopDropped();
    stopChanged();
    store.apply("SAVE5", discount, prices);
    store.drop("SAVE5");
    expect(dropped).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
