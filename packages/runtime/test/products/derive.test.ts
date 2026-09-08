import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProductDeriver,
  createSuperwallProduct,
  trialPeriodEndDate,
} from "../../src/products";

describe("trialPeriodEndDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats the editor's 'Jul 23, 2026' from a day count, number or string", () => {
    expect(trialPeriodEndDate(7, "en")).toBe("Jul 23, 2026");
    expect(trialPeriodEndDate("7", "en_US")).toBe("Jul 23, 2026");
  });

  it("localizes the month name where the runtime can", () => {
    expect(trialPeriodEndDate(7, "de")).toMatch(/^Juli? 23, 2026$/);
  });

  it("falls back to the default locale when the language is not a valid tag", () => {
    expect(trialPeriodEndDate(7, "not a locale!!")).toMatch(/^\w+ 23, 2026$/);
  });

  it("is nothing without a positive day count", () => {
    expect(trialPeriodEndDate(0, "en")).toBeUndefined();
    expect(trialPeriodEndDate("soon", "en")).toBeUndefined();
    expect(trialPeriodEndDate(undefined, "en")).toBeUndefined();
  });

  it("uses the runtime's default locale when no language is known", () => {
    expect(trialPeriodEndDate(7, undefined)).toMatch(/^\w+ 23, 2026$/);
  });
});

describe("createProductDeriver, one variable at a time", () => {
  it("localizes periodly alone and derives the end date with no language", () => {
    const derive = createProductDeriver();
    const raw = [
      createSuperwallProduct({
        reference: "primary",
        variables: { periodly: "monthly", trialPeriodDays: 3 },
      }),
    ];
    const [product] = derive(raw, []);
    expect(product?.variables.periodly).toBe("monthly");
    expect(product?.variables.period).toBeUndefined();
    expect(product?.variables.trialPeriodEndDate).toMatch(/^\w+ \d{1,2}, \d{4}$/);
  });
});

describe("createProductDeriver", () => {
  it("localizes period and periodly and derives the trial end date", () => {
    const derive = createProductDeriver();
    const raw = [
      createSuperwallProduct({
        reference: "primary",
        variables: { period: "year", periodly: "yearly", trialPeriodDays: 7 },
      }),
    ];

    const [product] = derive(raw, ["es"]);
    expect(product?.variables).toMatchObject({ period: "año", periodly: "anual" });
    expect(product?.variables.trialPeriodEndDate).toMatch(/^\w+ \d{1,2}, \d{4}$/);
  });

  it("never overwrites a host-provided trial end date", () => {
    const derive = createProductDeriver();
    const raw = [
      createSuperwallProduct({
        reference: "primary",
        variables: { trialPeriodDays: 7, trialPeriodEndDate: "Aug 1, 2026" },
      }),
    ];
    expect(derive(raw, ["en"])[0]?.variables.trialPeriodEndDate).toBe("Aug 1, 2026");
  });

  it("returns the same product object when nothing needs deriving", () => {
    const derive = createProductDeriver();
    const raw = [createSuperwallProduct({ reference: "primary", variables: { price: "$1" } })];
    expect(derive(raw, ["en"])[0]).toBe(raw[0]);
  });

  it("caches by input identity and languages", () => {
    const derive = createProductDeriver();
    const raw = [createSuperwallProduct({ reference: "primary", variables: { period: "month" } })];

    const first = derive(raw, ["en"]);
    expect(derive(raw, ["en"])).toBe(first);
    expect(derive(raw, ["de"])).not.toBe(first);
    expect(derive([...raw], ["en"])).not.toBe(first);
  });
});
