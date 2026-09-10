import { describe, expect, it } from "vitest";
import pingReply from "../../protocol/test/fixtures/host/ping-reply.json";
import {
  DEFAULT_PARAMS,
  DEFAULT_USER,
  createHostState,
  defaultDevice,
  pingReply as buildPingReply,
  products,
  substitutionsPrefix,
  templateVariables,
} from "../src";

export const FIXTURE_NOW = Date.UTC(2026, 8, 8, 12, 0, 0);

/**
 * The product bag the captured reply carries, kept here because reproducing that
 * capture is all it is for. The SDK sends whatever the store returned; a host
 * with no product data sends no variables at all.
 */
const FIXTURE_PRODUCT_VARIABLES = pingReply.events[0]?.variables?.products?.[0]?.primary as Record<
  string,
  unknown
>;

export const fixtureState = () =>
  createHostState({
    paywallId: "123",
    paywallIdentifier: "my_paywall",
    device: defaultDevice(FIXTURE_NOW),
    user: DEFAULT_USER,
    params: DEFAULT_PARAMS,
    products: [
      { reference: "primary", productId: "com.app.annual", variables: FIXTURE_PRODUCT_VARIABLES },
    ],
  });

describe("ping reply", () => {
  it("matches the web host's five-message burst byte for byte", () => {
    expect(buildPingReply(fixtureState())).toEqual(pingReply.events);
  });

  it("omits products from template_variables when there are none", () => {
    const state = createHostState({ device: { platform: "iOS" } });
    expect(templateVariables(state)).toEqual({
      event_name: "template_variables",
      variables: { device: { platform: "iOS" }, user: {}, params: {} },
    });
    expect(products(state)).toEqual({ event_name: "products", products: [] });
  });

  it("derives the prefix from trial days unless told otherwise", () => {
    const withTrial = fixtureState();
    expect(substitutionsPrefix(withTrial).prefix).toBe("freeTrial");
    expect(substitutionsPrefix({ ...withTrial, introductoryOfferEligible: false }).prefix).toBe(
      "default",
    );

    const noTrial = createHostState({
      products: [{ reference: "monthly", productId: "m", variables: { trialPeriodDays: "0" } }],
    });
    expect(substitutionsPrefix(noTrial).prefix).toBe("default");
    expect(substitutionsPrefix({ ...noTrial, introductoryOfferEligible: true }).prefix).toBe(
      "freeTrial",
    );
  });

  it("reads trial days the SDK way, as strings or numbers", () => {
    const stringDays = createHostState({
      products: [{ reference: "a", productId: "a", variables: { trialPeriodDays: "7" } }],
    });
    expect(substitutionsPrefix(stringDays).prefix).toBe("freeTrial");
    const garbage = createHostState({
      products: [{ reference: "a", productId: "a", variables: { trialPeriodDays: "soon" } }],
    });
    expect(substitutionsPrefix(garbage).prefix).toBe("default");
  });
});
