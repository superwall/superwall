import { describe, expect, it } from "vitest";
import { teleportOf } from "../../src/config";

describe("teleportOf", () => {
  it("is nothing for a paywall that never teleports, or turns it off", () => {
    expect(teleportOf(undefined)).toBeUndefined();
    expect(teleportOf(false)).toBeUndefined();
  });

  it("is every default for true, with no route of its own", () => {
    expect(teleportOf(true)).toEqual({
      overlay: true,
      fallbacks: {},
      completion: "confirmation",
      introductoryOfferEligibility: "automatic",
    });
  });

  it("fills every default the options leave out", () => {
    expect(teleportOf({ route: "checkout" })).toEqual({
      route: "checkout",
      overlay: true,
      fallbacks: {},
      completion: "confirmation",
      introductoryOfferEligibility: "automatic",
    });
  });

  it("keeps what the options say", () => {
    const resolved = {
      route: "plans",
      overlay: false,
      fallbacks: { card: "annual" },
      completion: "direct" as const,
      introductoryOfferEligibility: "eligible" as const,
    };
    expect(teleportOf(resolved)).toEqual(resolved);
  });
});
