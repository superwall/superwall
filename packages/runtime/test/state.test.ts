import { describe, expect, it } from "vitest";
import { createSuperwallProduct } from "../src/products";
import { buildSuperwallState } from "../src/session/state";

const primary = createSuperwallProduct({
  reference: "primary",
  productId: "pro_year",
  variables: { price: "$39.99" },
  source: "sdk",
});

describe("buildSuperwallState", () => {
  it("exposes product variables and identifiers under products.<reference>", () => {
    const state = buildSuperwallState({ variables: {}, products: [primary] }) as any;

    expect(state.products.primary).toMatchObject({
      price: "$39.99",
      productId: "pro_year",
      source: "sdk",
    });
  });

  it("tracks transaction flags and purchased/abandoned product state", () => {
    const completed = buildSuperwallState({
      variables: {},
      products: [primary],
      lastTransaction: { status: "completed", product: primary },
    }) as any;

    expect(completed.state).toEqual({
      didCompleteTransaction: true,
      didAbandonTransaction: false,
    });
    expect(completed.products.purchasedProductId).toBe("primary");
    expect(completed.products.purchased).toEqual({ price: "$39.99" });

    const abandoned = buildSuperwallState({
      variables: {},
      products: [primary],
      lastTransaction: { status: "abandoned", product: primary },
    }) as any;

    expect(abandoned.state.didAbandonTransaction).toBe(true);
    expect(abandoned.products.abandonedProductId).toBe("primary");
  });

  it("exposes trial eligibility as products.hasIntroductoryOffer", () => {
    const eligible = buildSuperwallState({
      variables: {},
      products: [],
      trial: { eligible: true },
    }) as any;
    expect(eligible.products.hasIntroductoryOffer).toBe(true);

    const unknown = buildSuperwallState({ variables: {}, products: [] }) as any;
    expect(unknown.products.hasIntroductoryOffer).toBeUndefined();
  });

  it("passes through variables, paywall, permissions, and callbacks", () => {
    const state = buildSuperwallState({
      variables: { device: { platform: "iOS" } },
      products: [],
      paywall: { id: "pw", identifier: "pw-id" },
      permissionStatuses: { notification: "granted" },
      callbackStates: { sync: { result: "success" } },
    }) as any;

    expect(state.device).toEqual({ platform: "iOS" });
    expect(state.paywall).toEqual({ id: "pw", identifier: "pw-id" });
    expect(state.permissions).toEqual({ notification: "granted" });
    expect(state.callbacks).toEqual({ sync: { result: "success" } });
  });
});
