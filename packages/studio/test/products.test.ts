import { describe, expect, it } from "vitest";
import { productVariables } from "../src/lib/products";

describe("productVariables", () => {
  it("derives the variables a paywall reads from what Superwall knows", () => {
    const variables = productVariables({
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
    expect(productVariables({ identifier: "lifetime" })).toEqual({ identifier: "lifetime" });
    expect(productVariables({})).toEqual({});
  });

  it("a product with no subscription keeps its price and gains no period", () => {
    const variables = productVariables({
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
    const variables = productVariables({
      identifier: "pro_999_month",
      price: { amount: 999, currency: "USD" },
      subscription: { period: "month", period_count: 1 },
    });
    expect(variables.yearlyPrice).toBe("$119.88");
    expect(variables.monthlyPrice).toBe("$9.99");
    expect(variables.periodMonths).toBe(1);
    expect(variables.trialPeriodDays).toBeUndefined();
  });

  it("falls back to a symbol when the currency is unknown to Intl", () => {
    const variables = productVariables({
      identifier: "odd",
      price: { amount: 100, currency: "ZZZ" },
    });
    expect(variables.currencySymbol).toBe("");
    expect(typeof variables.price).toBe("string");
  });
});
