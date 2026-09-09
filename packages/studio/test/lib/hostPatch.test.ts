import { describe, expect, it } from "vitest";
import { createHostState } from "@superwall/host";
import { hostPatch, hostStateFor, studioDefaults } from "../../src/lib/host";
import type { StudioSurface } from "../../src/lib/surfaces";

const surface: StudioSurface = {
  kind: "paywall",
  id: "plus",
  routes: [],
  locales: ["en", "es"],
  products: { monthly: "pro_999_month" },
};

const state = (over: Parameters<typeof hostStateFor>[0]) => hostStateFor(over);

const defaults = studioDefaults();

const inputs = (over: Partial<Parameters<typeof hostStateFor>[0]> = {}) => ({
  surface,
  defaults,
  samples: {},
  theme: "light" as const,
  edited: {},
  ...over,
});

describe("hostPatch", () => {
  it("sends nothing when nothing changed", () => {
    const before = state(inputs());
    const after = state(inputs());

    expect(hostPatch(before, after)).toEqual({});
  });

  it("sends only the fields that moved", () => {
    const before = state(inputs());
    const after = state(inputs({ theme: "dark" }));

    const patch = hostPatch(before, after);

    expect(Object.keys(patch)).toEqual(["device"]);
    expect(patch.device).toMatchObject({ interfaceStyle: "Dark" });
  });

  it("clears a variable the studio stopped sending", () => {
    const before = state(inputs({ samples: { user: { plan: "pro" } } }));
    const after = state(inputs());

    const patch = hostPatch(before, after);

    expect(patch.user).toHaveProperty("plan", undefined);
  });

  it("carries the identity a surface stands in for", () => {
    const before = createHostState({ paywallId: "1", paywallIdentifier: "plus" });
    const after = createHostState({ paywallId: "2", paywallIdentifier: "pro" });

    expect(hostPatch(before, after)).toMatchObject({
      paywallId: "2",
      paywallIdentifier: "pro",
    });
  });

  it("carries a changed trial eligibility on its own", () => {
    const before = createHostState({ introductoryOfferEligible: true });
    const after = createHostState({ introductoryOfferEligible: false });

    expect(hostPatch(before, after)).toEqual({ introductoryOfferEligible: false });
  });

  it("switches the locale the device reports, language code included", () => {
    const before = state(inputs({ locale: "en" }));
    const after = state(inputs({ locale: "es-MX" }));

    expect(hostPatch(before, after).device).toMatchObject({
      deviceLocale: "es-MX",
      deviceLanguageCode: "es",
    });
  });
});
