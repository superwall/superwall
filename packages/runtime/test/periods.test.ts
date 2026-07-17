import { describe, expect, it } from "vitest";
import { getLocalizedPeriod } from "../src/localization/periods";

describe("getLocalizedPeriod", () => {
  it("fully localizes dynamic periodly values in supported locales", () => {
    expect(getLocalizedPeriod("every 4 week", ["fr"])).toBe("toutes les 4 semaines");
    expect(getLocalizedPeriod("every 3 month", ["es"])).toBe("cada 3 meses");
    expect(getLocalizedPeriod("every 2 year", ["de"])).toBe("alle 2 Jahre");
  });

  it("falls back to English for unsupported dynamic periodly locales", () => {
    expect(getLocalizedPeriod("every 4 week", ["sv"])).toBe("every 4 weeks");
  });
});
