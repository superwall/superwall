import { describe, expect, it } from "vitest";
import { catalogProductVariables } from "../../src/products/catalog";

describe("catalogProductVariables", () => {
  it("derives the variables a paywall reads from what Superwall knows", () => {
    const variables = catalogProductVariables({
      identifier: "pro_5999_year",
      price: { amount: 5999, currency: "USD" },
      subscription: { period: "year", period_count: 1, trial_period_days: 7 },
    });

    expect(variables).toMatchObject({
      price: "$59.99",
      rawPrice: 59.99,
      period: "year",
      periodly: "yearly",
      periodYears: 1,
      monthlyPrice: "$5.00",
      weeklyPrice: "$1.15",
      currencyCode: "USD",
      currencySymbol: "$",
      trialPeriodDays: 7,
      trialPeriodText: "7-day",
    });
  });

  it("invents nothing the dashboard cannot answer for", () => {
    expect(catalogProductVariables({ identifier: "lifetime" })).toEqual({ identifier: "lifetime" });
    expect(catalogProductVariables({})).toEqual({});
  });

  it("a product with no subscription keeps its price and gains no period", () => {
    const variables = catalogProductVariables({
      identifier: "coins_100",
      price: { amount: 299, currency: "EUR" },
    });
    expect(variables).toEqual({
      identifier: "coins_100",
      price: "€2.99",
      rawPrice: 2.99,
      currencyCode: "EUR",
      currencySymbol: "€",
    });
  });

  it("a monthly product derives its yearly equivalent, not the other way round", () => {
    const variables = catalogProductVariables({
      identifier: "pro_999_month",
      price: { amount: 999, currency: "USD" },
      subscription: { period: "month", period_count: 1 },
    });
    expect(variables.yearlyPrice).toBe("$119.88");
    expect(variables.monthlyPrice).toBe("$9.99");
    expect(variables.periodMonths).toBe(1);
    expect(variables.trialPeriodDays).toBeUndefined();
  });

  it("answers every period unit, the way the dashboard's engine does", () => {
    const yearly = catalogProductVariables({
      price: { amount: 5999, currency: "USD" },
      subscription: { period: "year", period_count: 1 },
    });
    expect(yearly).toMatchObject({
      periodDays: 365,
      periodWeeks: 52,
      periodMonths: 12,
      periodYears: 1,
    });

    const monthly = catalogProductVariables({
      price: { amount: 999, currency: "USD" },
      subscription: { period: "month", period_count: 1 },
    });
    expect(monthly).toMatchObject({
      periodDays: 30,
      periodWeeks: 4,
      periodMonths: 1,
      periodYears: 0,
    });

    const weekly = catalogProductVariables({
      price: { amount: 299, currency: "USD" },
      subscription: { period: "week", period_count: 2 },
    });
    expect(weekly).toMatchObject({
      periodDays: 14,
      periodWeeks: 2,
      periodMonths: 0,
      periodYears: 0,
    });

    const quarterly = catalogProductVariables({
      price: { amount: 2999, currency: "USD" },
      subscription: { period: "month", period_count: 3 },
    });
    expect(quarterly).toMatchObject({
      periodDays: 90,
      periodWeeks: 12,
      periodMonths: 3,
      periodYears: 0,
    });

    const daily = catalogProductVariables({
      price: { amount: 99, currency: "USD" },
      subscription: { period: "day", period_count: 10 },
    });
    expect(daily).toMatchObject({
      periodDays: 10,
      periodWeeks: 1,
      periodMonths: 0,
      periodYears: 0,
    });
  });

  it("a period it has never heard of gains no counts rather than wrong ones", () => {
    const variables = catalogProductVariables({
      price: { amount: 100, currency: "USD" },
      subscription: { period: "fortnight", period_count: 1 },
    });

    expect(variables.period).toBe("fortnight");
    expect(variables.periodly).toBe("fortnightly");
    expect(variables.periodDays).toBeUndefined();
  });

  it("falls back to a symbol when the currency is unknown to Intl", () => {
    const variables = catalogProductVariables({
      identifier: "odd",
      price: { amount: 100, currency: "ZZZ" },
    });
    expect(variables.currencySymbol).toBe("");
    expect(typeof variables.price).toBe("string");
  });
});
