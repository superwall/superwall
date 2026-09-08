import { describe, expect, it } from "vitest";
import { resolveLocale } from "../../src/localization";

const localization = {
  defaultLocale: "en",
  messages: {
    en: { plain: "Plain" },
    de: { plain: "Schlicht" },
    "pt-BR": { plain: "Simples" },
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
    expect(resolveLocale("-", localization)).toBe("en");
  });
});
