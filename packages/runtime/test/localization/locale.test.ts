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

  it("maps legacy Android language codes to their modern catalogs", () => {
    const catalogs = {
      defaultLocale: "en",
      messages: { en: {}, id: {}, "he-IL": {}, he: {}, yi: {} },
    };
    expect(resolveLocale("in_ID", catalogs)).toBe("id");
    expect(resolveLocale("in-ID", catalogs)).toBe("id");
    expect(resolveLocale("in", catalogs)).toBe("id");
    expect(resolveLocale("iw_IL", catalogs)).toBe("he-IL");
    expect(resolveLocale("iw", catalogs)).toBe("he");
    expect(resolveLocale("ji", catalogs)).toBe("yi");
    expect(resolveLocale("in_ID", { defaultLocale: "en", messages: { en: {}, "id-ID": {} } })).toBe(
      "id-ID",
    );
  });

  it("matches catalogs keyed with a legacy code from either code", () => {
    const catalogs = { defaultLocale: "en", messages: { en: {}, in: {}, "iw-IL": {} } };
    expect(resolveLocale("in_ID", catalogs)).toBe("in");
    expect(resolveLocale("id-ID", catalogs)).toBe("in");
    expect(resolveLocale("he_IL", catalogs)).toBe("iw-IL");
  });

  it("prefers the modern key when both the legacy and modern catalogs exist", () => {
    expect(resolveLocale("in_ID", { defaultLocale: "en", messages: { in: {}, id: {} } })).toBe(
      "id",
    );
    expect(resolveLocale("in_ID", { defaultLocale: "en", messages: { id: {}, in: {} } })).toBe(
      "id",
    );
  });

  it("falls back between nb and no when the exact catalog is absent", () => {
    expect(resolveLocale("nb_NO", { defaultLocale: "en", messages: { en: {}, no: {} } })).toBe(
      "no",
    );
    expect(resolveLocale("no", { defaultLocale: "en", messages: { en: {}, nb: {} } })).toBe("nb");
    expect(resolveLocale("nb_NO", { defaultLocale: "en", messages: { no: {}, nb: {} } })).toBe(
      "nb",
    );
    expect(resolveLocale("no_NO", { defaultLocale: "en", messages: { nb: {}, no: {} } })).toBe(
      "no",
    );
  });
});
