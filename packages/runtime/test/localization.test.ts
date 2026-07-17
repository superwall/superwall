import { describe, expect, it } from "vitest";
import { createTranslator, languageCandidates, resolveLocale } from "../src/localization";

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

describe("resolveLocale", () => {
  it("matches exact locales, case- and separator-insensitively", () => {
    expect(resolveLocale("de", localization)).toBe("de");
    expect(resolveLocale("de_DE", localization)).toBe("de");
    expect(resolveLocale("pt_BR", localization)).toBe("pt-BR");
    expect(resolveLocale("PT-br", localization)).toBe("pt-BR");
  });

  it("falls back from region to language to default", () => {
    expect(resolveLocale("de_AT", localization)).toBe("de");
    expect(resolveLocale("fr_FR", localization)).toBe("en");
  });

  it("handles missing input and missing catalogs", () => {
    expect(resolveLocale(undefined, localization)).toBe("en");
    expect(resolveLocale("de", undefined)).toBe("en");
    expect(resolveLocale("de", { defaultLocale: "es" })).toBe("es");
  });
});

describe("languageCandidates", () => {
  it("produces underscore-normalized full locale plus language", () => {
    expect(languageCandidates("de-DE")).toEqual(["de_DE", "de"]);
    expect(languageCandidates("pt_BR")).toEqual(["pt_BR", "pt"]);
    expect(languageCandidates("es")).toEqual(["es"]);
    expect(languageCandidates(undefined)).toEqual(["en"]);
  });
});

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
    expect(t("Literal copy")).toBe("Literal copy");
  });

  it("falls back to the default locale catalog per key", () => {
    const { t } = createTranslator(localization, "de");
    expect(t("paywall.title")).toBe("Hol dir Pro");
    expect(t("paywall.cta", { days: 3, price: "$1" })).toBe("Start 3-day trial for $1");
  });

  it("reports available locales", () => {
    expect(createTranslator(localization, "en").locales).toEqual(["en", "de", "pt-BR"]);
    expect(createTranslator(undefined, "en").locales).toEqual(["en"]);
  });
});
