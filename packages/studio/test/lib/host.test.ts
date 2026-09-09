import { describe, expect, it } from "vitest";
import { hostStateFor, studioDefaults } from "../../src/lib/host";
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

describe("hostStateFor", () => {
  it("names the paywall a surface stands in for, falling back to its id", () => {
    expect(state(inputs())).toMatchObject({ paywallId: "0", paywallIdentifier: "plus" });
    expect(
      state(inputs({ surface: { ...surface, paywallId: "208540", paywallIdentifier: "plus_up" } })),
    ).toMatchObject({ paywallId: "208540", paywallIdentifier: "plus_up" });
  });

  it("tells the paywall which interface style the studio is showing", () => {
    expect(state(inputs()).device).toMatchObject({ interfaceStyle: "Light" });
    expect(state(inputs({ theme: "dark" })).device).toMatchObject({ interfaceStyle: "Dark" });
  });

  it("switches the locale the device reports, language code included", () => {
    expect(state(inputs({ locale: "es-MX" })).device).toMatchObject({
      deviceLocale: "es-MX",
      deviceLanguageCode: "es",
    });
  });

  it("prices a slot from the samples, and shows an example where it cannot", () => {
    const priced = state(
      inputs({ samples: { products: { pro_999_month: { price: "$9.99" } } } }),
    ).products;
    expect(priced[0]).toMatchObject({ reference: "monthly", productId: "pro_999_month" });
    expect(priced[0]?.variables).toMatchObject({ price: "$9.99" });

    const example = state(inputs()).products[0];
    expect(example?.variables.price).toBeTypeOf("string");
  });

  it("lets an edited variable win over the sample it came from", () => {
    const edited = state(
      inputs({
        samples: { device: { platform: "iOS" } },
        edited: { device: { platform: "Android" }, products: { monthly: { price: "free" } } },
      }),
    );

    expect(edited.device).toMatchObject({ platform: "Android" });
    expect(edited.products[0]?.variables).toMatchObject({ price: "free" });
  });

  it("carries the frame's own device properties over the defaults", () => {
    expect(state(inputs({ frame: { deviceModel: "iPad14,1" } })).device).toMatchObject({
      deviceModel: "iPad14,1",
    });
  });
});
