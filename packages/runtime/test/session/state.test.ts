import { describe, expect, it } from "vitest";
import { createSuperwallProduct } from "../../src/products";
import { buildSuperwallState } from "../../src/session/state";

const primary = createSuperwallProduct({
  reference: "primary",
  productId: "pro_year",
  variables: { price: "$39.99" },
  source: "sdk",
});

describe("buildSuperwallState", () => {
  it("exposes product variables and identifiers under products.<reference>", () => {
    const state = buildSuperwallState({ variables: {}, products: [primary] });
    expect(state.products).toMatchObject({
      primary: { price: "$39.99", productId: "pro_year", source: "sdk" },
    });
  });

  it("layers host products over the template's product variables, legacy keys included", () => {
    const state = buildSuperwallState({
      variables: { primary: { price: "$1.00", trialPeriodDays: 7 } },
      products: [primary],
    });
    expect(state.products).toMatchObject({
      primary: { price: "$39.99", trialPeriodDays: 7, productId: "pro_year" },
    });
  });

  it("tracks transaction flags and purchased/abandoned product state", () => {
    const completed = buildSuperwallState({
      variables: {},
      products: [primary],
      lastTransaction: { status: "completed", product: primary },
    });
    expect(completed.state).toEqual({ didCompleteTransaction: true, didAbandonTransaction: false });
    expect(completed.products).toMatchObject({
      purchasedProductId: "primary",
      abandonedProductId: "",
      purchased: { price: "$39.99" },
    });

    const abandoned = buildSuperwallState({
      variables: {},
      products: [primary],
      lastTransaction: { status: "abandoned", product: primary },
    });
    expect(abandoned.state).toMatchObject({ didAbandonTransaction: true });
    expect(abandoned.products).toMatchObject({ abandonedProductId: "primary" });
  });

  it("exposes eligibility as products.hasIntroductoryOffer only once known", () => {
    expect(
      buildSuperwallState({ variables: {}, products: [], introductoryOffer: { eligible: true } })
        .products,
    ).toMatchObject({ hasIntroductoryOffer: true });
    expect(buildSuperwallState({ variables: {}, products: [] }).products).not.toHaveProperty(
      "hasIntroductoryOffer",
    );
  });

  it("passes through variables, paywall, permissions, and callbacks", () => {
    const state = buildSuperwallState({
      variables: { device: { platform: "iOS" } },
      products: [],
      paywall: { id: "pw", identifier: "pw-id" },
      permissionStatuses: { notification: "granted" },
      callbackStates: { sync: { result: "success" } },
    });
    expect(state.device).toEqual({ platform: "iOS" });
    expect(state.paywall).toEqual({ id: "pw", identifier: "pw-id" });
    expect(state.permissions).toEqual({ notification: "granted" });
    expect(state.callbacks).toEqual({ sync: { result: "success" } });
    expect(buildSuperwallState({ variables: {}, products: [] })).not.toHaveProperty("paywall");
  });
});
