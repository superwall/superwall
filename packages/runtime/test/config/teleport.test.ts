import { describe, expect, it } from "vitest";
import { teleportOf } from "../../src/config";

describe("teleportOf", () => {
  it("is nothing for a paywall that never teleports", () => {
    expect(teleportOf(undefined)).toBeUndefined();
  });

  it("fills every default the config leaves out", () => {
    expect(teleportOf({ route: "checkout" })).toEqual({
      route: "checkout",
      overlay: true,
      fallbacks: {},
      returnStyle: "screen",
      appLink: "universal",
      trialEligibility: "matchApp",
    });
  });

  it("keeps what the config says", () => {
    const resolved = {
      route: "plans",
      overlay: false,
      fallbacks: { card: "annual" },
      returnStyle: "alert" as const,
      appLink: "scheme" as const,
      trialEligibility: "always" as const,
    };
    expect(teleportOf(resolved)).toEqual(resolved);
  });
});
