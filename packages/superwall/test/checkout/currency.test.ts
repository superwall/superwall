import { describe, expect, it } from "vitest";
import { formatMinorUnits, minorUnitsToAmount } from "../../src/checkout/utils/currency";

// Intl separates symbol and amount with a non-breaking space in some locales.
const plain = (value: string) => value.replace(/\u00a0/g, " ");

describe("minorUnitsToAmount", () => {
  it("divides two-decimal currencies by 100", () => {
    expect(minorUnitsToAmount(10500, "usd")).toBe(105);
  });

  it("leaves zero-decimal currencies whole", () => {
    expect(minorUnitsToAmount(105, "JPY")).toBe(105);
  });

  it("divides three-decimal currencies by 1000", () => {
    expect(minorUnitsToAmount(1500, "kwd")).toBe(1.5);
  });
});

describe("formatMinorUnits", () => {
  it("drops the fraction on whole amounts", () => {
    expect(formatMinorUnits(900, "usd")).toBe("$9");
  });

  it("keeps two decimals otherwise", () => {
    expect(formatMinorUnits(1999, "usd")).toBe("$19.99");
  });

  it("formats zero-decimal currencies without dividing", () => {
    expect(formatMinorUnits(500, "jpy", "ja-JP")).toBe("￥500");
  });

  it("formats three-decimal currencies with three decimals", () => {
    expect(plain(formatMinorUnits(1500, "kwd"))).toBe("KWD 1.500");
  });

  it("accepts underscore locales from the SDK", () => {
    expect(plain(formatMinorUnits(1999, "eur", "de_DE"))).toBe("19,99 €");
  });
});
