import { describe, expect, it } from "vitest";
import { getLocalizedPeriod, languageCandidates } from "../../src/localization/periods";

describe("languageCandidates", () => {
  it("produces the table's underscore keys: full locale, then language", () => {
    expect(languageCandidates("de-DE")).toEqual(["de_DE", "de"]);
    expect(languageCandidates("pt_BR")).toEqual(["pt_BR", "pt"]);
    expect(languageCandidates("es")).toEqual(["es"]);
    expect(languageCandidates(undefined)).toEqual(["en"]);
  });
});

describe("getLocalizedPeriod", () => {
  it("translates table periods for the first language that has them", () => {
    expect(getLocalizedPeriod("year", ["es"])).toBe("año");
    expect(getLocalizedPeriod("yearly", ["pt_BR", "pt"])).toBe("anual");
    expect(getLocalizedPeriod("month", ["xx", "es"])).toBe("mes");
  });

  it("maps an already-localized value back through its canonical key", () => {
    expect(getLocalizedPeriod("año", ["en"])).toBe("year");
  });

  it("fully localizes dynamic periodly values in supported locales", () => {
    expect(getLocalizedPeriod("every 4 week", ["fr"])).toBe("toutes les 4 semaines");
    expect(getLocalizedPeriod("every 2 month", ["fr"])).toBe("tous les 2 mois");
    expect(getLocalizedPeriod("every 3 month", ["es"])).toBe("cada 3 meses");
    expect(getLocalizedPeriod("every 2 year", ["de"])).toBe("alle 2 Jahre");
    expect(getLocalizedPeriod("every 2 month", ["it"])).toBe("ogni 2 mesi");
    expect(getLocalizedPeriod("every 2 month", ["pt"])).toBe("cada 2 meses");
  });

  it("falls back to English for unsupported dynamic periodly locales", () => {
    expect(getLocalizedPeriod("every 4 week", ["sv"])).toBe("every 4 weeks");
  });

  it("returns unknown values untouched", () => {
    expect(getLocalizedPeriod("forever", ["de"])).toBe("forever");
    expect(getLocalizedPeriod("año", ["xx"])).toBe("año");
    expect(getLocalizedPeriod("every 2 decade", ["en"])).toBe("every 2 decade");
  });

  it("localizes bare recurring counts through Intl, or by hand where Intl cannot", () => {
    expect(getLocalizedPeriod("3 week", ["de"])).toBe("3 Wochen");
    expect(getLocalizedPeriod("1 week", ["not a locale!!"])).toBe("1 week");
    expect(getLocalizedPeriod("3 weeks", ["not a locale!!"])).toBe("3 weeks");
    expect(getLocalizedPeriod("2 month", [])).toBe("2 months");
  });

  it("skips blank languages when choosing a periodly formatter", () => {
    expect(getLocalizedPeriod("every 2 year", ["  ", "de-AT"])).toBe("alle 2 Jahre");
  });
});
