import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTranslation } from "../src";
import { flush, renderWithProvider } from "./helpers";

describe("useTranslation", () => {
  it("translates, switches locales, and lists catalogs", async () => {
    const { result } = renderWithProvider(() => useTranslation());
    await flush();

    expect(result.current.locale).toBe("en");
    expect(result.current.t("paywall.title")).toBe("Go Pro");
    expect(result.current.locales).toEqual(["en", "de"]);

    act(() => {
      result.current.setLocale("de");
    });

    expect(result.current.locale).toBe("de");
    expect(result.current.t("paywall.title")).toBe("Hol dir Pro");
  });

  it("auto-detects the locale from mock device variables", async () => {
    const { result } = renderWithProvider(() => useTranslation(), {
      mock: { device: { locale: "de_DE" } },
    });
    await flush();

    await waitFor(() => expect(result.current.locale).toBe("de"));
    expect(result.current.t("paywall.title")).toBe("Hol dir Pro");
  });
});
