// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PaywallSettings as CliPaywallSettings } from "../../../cli/src/core/paywalls/project/framework";
import { paywallSettingsOf, type PaywallSettings } from "../../src/build/settings";

/**
 * The CLI declares this wire itself: it loads whatever superwall version the
 * project installed, so its types cannot be this package's — a Node CLI would
 * have to pull the framework's DOM-typed source into its own typecheck. These
 * assignments are the guard instead, so the two declarations cannot drift
 * without failing a gate here.
 */
describe("the CLI's copy of the settings wire", () => {
  it("is the same shape this package stamps", () => {
    const mine: PaywallSettings = paywallSettingsOf({ presentation: { style: "drawer" } });
    const theirs: CliPaywallSettings = mine;
    const back: PaywallSettings = theirs;

    expect(back).toBe(mine);
  });

  it("agrees on every optional key", () => {
    const full: Required<PaywallSettings> = {
      presentation_style: { type: "POPUP", width: 80, height: 60, corner_radius: 15 },
      feature_gating: "gated",
      on_device_cache: false,
      scroll_enabled: false,
      game_controller_enabled: true,
      introductory_offer_eligibility: "always_eligible",
      web_checkout_destination: "PAYWALL_APPLE_PAY",
      background_color_hex: "#ffffff",
      dark_background_color_hex: "#0d0f12",
    };
    const theirs: Required<CliPaywallSettings> = full;

    expect(theirs).toEqual(full);
  });
});
