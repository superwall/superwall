import { describe, expect, it } from "vitest";
import { createTranslator } from "../../src/localization";

const localization = {
  defaultLocale: "en",
  messages: {
    en: {
      paywall: { title: "Go Pro", cta: "Start {days}-day trial for {price}" },
      plain: "Plain",
    },
    de: { paywall: { title: "Hol dir Pro" } },
    "pt-BR": { paywall: { title: "Seja Pro" } },
  },
};

describe("createTranslator", () => {
  it("resolves nested keys and interpolates values", () => {
    const { t } = createTranslator(localization, "en");
    expect(t("paywall.title")).toBe("Go Pro");
    expect(t("paywall.cta", { days: 7, price: "$39.99" })).toBe("Start 7-day trial for $39.99");
    expect(t("plain")).toBe("Plain");
  });

  it("keeps unresolved placeholders and unknown keys verbatim", () => {
    const { t } = createTranslator(localization, "en");
    expect(t("paywall.cta", { days: 7 })).toBe("Start 7-day trial for {price}");
    expect(t("missing.key")).toBe("missing.key");
    expect(t("paywall.title.deeper")).toBe("paywall.title.deeper");
    expect(t("paywall")).toBe("paywall");
    expect(t("Literal copy")).toBe("Literal copy");
  });

  it("falls back to the default locale catalog per key", () => {
    const { t } = createTranslator(localization, "de");
    expect(t("paywall.title")).toBe("Hol dir Pro");
    expect(t("paywall.cta", { days: 3, price: "$1" })).toBe("Start 3-day trial for $1");
  });

  it("reports the active locale and the available ones", () => {
    expect(createTranslator(localization, "en").locale).toBe("en");
    expect(createTranslator(localization, "en").locales).toEqual(["en", "de", "pt-BR"]);
    expect(createTranslator(undefined, "en").locales).toEqual(["en"]);
    expect(createTranslator(undefined, "en").t("x.y")).toBe("x.y");
  });
});
