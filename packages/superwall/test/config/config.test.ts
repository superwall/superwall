import { describe, expect, it } from "vitest";
import { defineConfig, mergeSurfaceConfig } from "../../src/config";
import { mergeMessages } from "../../src/config/messages";
import { definePaywall } from "../../src/config/paywall";

describe("mergeSurfaceConfig", () => {
  it("surface fields win over app defaults; groups merge one level deep", () => {
    const merged = mergeSurfaceConfig(
      {
        featureGating: "gated",
        scrollEnabled: false,
        presentation: { style: "fullscreen", condition: "always" },
        notifications: { trialReminder: { enabled: true, title: "Reminder", body: "Ends soon" } },
      },
      {
        featureGating: "nonGated",
        presentation: { style: "modal" },
      },
    );

    expect(merged.featureGating).toBe("nonGated");
    // Untouched defaults survive.
    expect(merged.scrollEnabled).toBe(false);
    // Group merge: surface overrides one field without restating the group.
    expect(merged.presentation).toEqual({ style: "modal", condition: "always" });
    expect(merged.notifications).toEqual({
      trialReminder: { enabled: true, title: "Reminder", body: "Ends soon" },
    });
  });

  it("merges localization catalogs per locale", () => {
    const merged = mergeSurfaceConfig(
      {
        localization: {
          defaultLocale: "en",
          messages: { en: { common: { restore: "Restore" } } },
        },
      },
      {
        localization: {
          defaultLocale: "en",
          messages: { es: { common: { restore: "Restaurar" } } },
        },
      },
    );

    expect(Object.keys(merged.localization?.messages ?? {}).toSorted()).toEqual(["en", "es"]);
  });

  it("handles absent sides", () => {
    expect(mergeSurfaceConfig(undefined, undefined)).toMatchObject({
      presentation: undefined,
      notifications: undefined,
      localization: undefined,
    });
    expect(mergeSurfaceConfig({ featureGating: "gated" }, undefined).featureGating).toBe("gated");
  });
});

describe("mergeMessages", () => {
  it("deep-merges catalogs with later keys winning", () => {
    const merged = mergeMessages(
      { paywall: { title: "Go Pro", cta: "Buy" }, footer: "Legal" },
      { paywall: { title: "Go Plus" } },
    );
    expect(merged).toEqual({ paywall: { title: "Go Plus", cta: "Buy" }, footer: "Legal" });
  });

  it("replaces when shapes disagree and tolerates undefined", () => {
    expect(mergeMessages({ a: { deep: "x" } }, { a: "flat" })).toEqual({ a: "flat" });
    expect(mergeMessages(undefined, undefined)).toEqual({});
  });
});

describe("define* helpers", () => {
  it("pass definitions through unchanged (identity contracts)", () => {
    const app = defineConfig({ defaults: { featureGating: "gated" } });
    expect(app.defaults?.featureGating).toBe("gated");

    const paywall = definePaywall({ featureGating: "gated", products: { go: "sku_go" } });
    expect(paywall.featureGating).toBe("gated");
    expect(paywall.products).toEqual({ go: "sku_go" });
  });
});
