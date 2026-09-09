import { describe, expect, it } from "vitest";
import {
  createHostState,
  diffHostState,
  hasIntroductoryOffer,
  mergeHostState,
  NO_EXPERIMENT,
  trialPeriodDays,
  type HostState,
} from "../src/state";

const state = (over: Partial<HostState> = {}) =>
  createHostState({ paywallId: "1", paywallIdentifier: "plus", ...over });

describe("diffHostState", () => {
  it("sends nothing when nothing changed", () => {
    expect(diffHostState(state(), state())).toEqual({});
  });

  it("sends only the variables that moved", () => {
    const patch = diffHostState(
      state({ device: { platform: "iOS", osVersion: "18.0" } }),
      state({ device: { platform: "iOS", osVersion: "26.0" } }),
    );

    expect(patch).toEqual({ device: { osVersion: "26.0" } });
  });

  it("clears a variable the host stopped sending", () => {
    const patch = diffHostState(state({ user: { plan: "pro" } }), state({ user: {} }));

    expect(patch.user).toHaveProperty("plan", undefined);
  });

  it("sends the whole product list when any of it changed", () => {
    const before = state({ products: [{ reference: "annual", productId: "a", variables: {} }] });
    const after = state({
      products: [{ reference: "annual", productId: "a", variables: { price: "$59.99" } }],
    });

    expect(diffHostState(before, after).products).toEqual(after.products);
  });

  it("carries identity, eligibility and experiment changes", () => {
    expect(diffHostState(state(), state({ paywallId: "2" }))).toEqual({ paywallId: "2" });
    expect(diffHostState(state(), state({ paywallIdentifier: "pro" }))).toEqual({
      paywallIdentifier: "pro",
    });
    expect(diffHostState(state(), state({ introductoryOfferEligible: true }))).toEqual({
      introductoryOfferEligible: true,
    });

    const experiment = { experimentId: "7", variantId: "b", campaignId: "3" };
    expect(diffHostState(state(), state({ experiment })).experiment).toEqual(experiment);
  });

  /**
   * The two halves of the wire have to agree: applying what the diff produced
   * must land on the state that produced it, including the keys it cleared.
   */
  it("round-trips through mergeHostState", () => {
    const before = state({
      device: { platform: "iOS", locale: "en" },
      user: { plan: "pro" },
      params: { placement: "campaign_trigger" },
      products: [{ reference: "annual", productId: "a", variables: { price: "$1" } }],
      introductoryOfferEligible: true,
    });
    const after = state({
      device: { platform: "iOS", osVersion: "26.0" },
      user: {},
      params: { placement: "campaign_trigger", extra: 1 },
      products: [{ reference: "monthly", productId: "m", variables: {} }],
    });

    expect(mergeHostState(before, diffHostState(before, after))).toEqual(after);
  });
});

describe("createHostState", () => {
  it("fills in what a host did not say", () => {
    const fresh = createHostState();

    expect(fresh).toMatchObject({
      paywallId: "0",
      paywallIdentifier: "paywall",
      device: {},
      user: {},
      params: {},
      products: [],
      experiment: NO_EXPERIMENT,
    });
    expect("introductoryOfferEligible" in fresh).toBe(false);
  });

  it("keeps no variable whose value is undefined", () => {
    const fresh = createHostState({ device: { platform: "iOS", osVersion: undefined } });

    expect(fresh.device).toEqual({ platform: "iOS" });
  });
});

describe("mergeHostState", () => {
  it("merges variables rather than replacing the record", () => {
    const merged = mergeHostState(state({ device: { platform: "iOS", locale: "en" } }), {
      device: { locale: "es" },
    });

    expect(merged.device).toEqual({ platform: "iOS", locale: "es" });
  });

  it("removes eligibility when a patch clears it, and leaves it alone otherwise", () => {
    const eligible = state({ introductoryOfferEligible: true });

    expect("introductoryOfferEligible" in mergeHostState(eligible, {})).toBe(true);
    expect(
      "introductoryOfferEligible" in
        mergeHostState(eligible, { introductoryOfferEligible: undefined }),
    ).toBe(false);
  });
});

describe("introductory offers", () => {
  it("reads a trial from a product, however the variable was typed", () => {
    expect(trialPeriodDays({ reference: "a", productId: "a", variables: {} })).toBe(0);
    expect(
      trialPeriodDays({ reference: "a", productId: "a", variables: { trialPeriodDays: 7 } }),
    ).toBe(7);
    expect(
      trialPeriodDays({ reference: "a", productId: "a", variables: { trialPeriodDays: "14" } }),
    ).toBe(14);
    expect(
      trialPeriodDays({ reference: "a", productId: "a", variables: { trialPeriodDays: "soon" } }),
    ).toBe(0);
  });

  it("is eligible when a product offers a trial, unless the host said otherwise", () => {
    const trialling = state({
      products: [{ reference: "a", productId: "a", variables: { trialPeriodDays: 7 } }],
    });

    expect(hasIntroductoryOffer(trialling)).toBe(true);
    expect(hasIntroductoryOffer(state())).toBe(false);
    expect(hasIntroductoryOffer({ ...trialling, introductoryOfferEligible: false })).toBe(false);
    expect(hasIntroductoryOffer(state({ introductoryOfferEligible: true }))).toBe(true);
  });
});
