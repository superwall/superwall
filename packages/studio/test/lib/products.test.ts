import { describe, expect, it } from "vitest";
import { productVariables } from "../../src/lib/products";

const trialKeys = (variables: Record<string, unknown>) =>
  Object.keys(variables).filter((key) => key.toLowerCase().includes("trial"));

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

  it("answers every period unit, the way the dashboard's engine does", () => {
    const yearly = productVariables({
      price: { amount: 5999, currency: "USD" },
      subscription: { period: "year", period_count: 1 },
    });
    expect(yearly).toMatchObject({
      periodDays: 365,
      periodWeeks: 52,
      periodMonths: 12,
      periodYears: 1,
    });

    const monthly = productVariables({
      price: { amount: 999, currency: "USD" },
      subscription: { period: "month", period_count: 1 },
    });
    expect(monthly).toMatchObject({
      periodDays: 30,
      periodWeeks: 4,
      periodMonths: 1,
      periodYears: 0,
    });

    const weekly = productVariables({
      price: { amount: 299, currency: "USD" },
      subscription: { period: "week", period_count: 2 },
    });
    expect(weekly).toMatchObject({
      periodDays: 14,
      periodWeeks: 2,
      periodMonths: 0,
      periodYears: 0,
    });

    const quarterly = productVariables({
      price: { amount: 2999, currency: "USD" },
      subscription: { period: "month", period_count: 3 },
    });
    expect(quarterly).toMatchObject({
      periodDays: 90,
      periodWeeks: 12,
      periodMonths: 3,
      periodYears: 0,
    });

    const daily = productVariables({
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
    const variables = productVariables({
      price: { amount: 100, currency: "USD" },
      subscription: { period: "fortnight", period_count: 1 },
    });

    expect(variables.period).toBe("fortnight");
    expect(variables.periodly).toBe("fortnightly");
    expect(variables.periodDays).toBeUndefined();
  });

  it.each([
    { period: "month", period_count: 1, label: "month", periodly: "monthly", monthly: "$29.99" },
    {
      period: "month",
      period_count: 3,
      label: "quarter",
      periodly: "quarterly",
      monthly: "$10.00",
    },
    {
      period: "month",
      period_count: 6,
      label: "6 months",
      periodly: "every 6 months",
      monthly: "$5.00",
    },
    {
      period: "week",
      period_count: 2,
      label: "2 weeks",
      periodly: "every 2 weeks",
      monthly: "$64.98",
    },
    {
      period: "year",
      period_count: 2,
      label: "2 years",
      periodly: "every 2 years",
      monthly: "$1.25",
    },
  ])(
    "a $period × $period_count price reads as $label / $periodly",
    ({ period, period_count, label, periodly, monthly }) => {
      const variables = productVariables({
        price: { amount: 2999, currency: "USD" },
        subscription: { period, period_count },
      });

      expect(variables).toMatchObject({ period: label, periodly, monthlyPrice: monthly });
    },
  );

  it("a period it has never heard of keeps its own name whatever the count", () => {
    const variables = productVariables({
      price: { amount: 100, currency: "USD" },
      subscription: { period: "fortnight", period_count: 2 },
    });

    expect(variables).toMatchObject({ period: "fortnight", periodly: "fortnightly" });
  });

  it("falls back to a symbol when the currency is unknown to Intl", () => {
    const variables = productVariables({
      identifier: "odd",
      price: { amount: 100, currency: "ZZZ" },
    });
    expect(variables.currencySymbol).toBe("");
    expect(typeof variables.price).toBe("string");
  });

  describe("a trial", () => {
    const annual = {
      identifier: "annual",
      price: { amount: 5999, currency: "USD" },
    };

    it("a free trial reads as $0.00 and 0, the way the SDK sends it", () => {
      const variables = productVariables({
        ...annual,
        trial_price: { amount: 0, currency: "USD" },
        subscription: { period: "year", period_count: 1, trial_period_days: 7 },
      });

      expect(variables).not.toHaveProperty("trialPeriodEndDate");
      expect(variables).toMatchObject({
        trialPeriodDays: 7,
        trialPeriodWeeks: 1,
        trialPeriodMonths: 0,
        trialPeriodYears: 0,
        trialPeriodText: "7-day",
        rawTrialPeriodPrice: 0,
        trialPeriodPrice: "$0.00",
        trialPeriodDailyPrice: "$0.00",
        trialPeriodWeeklyPrice: "$0.00",
        trialPeriodMonthlyPrice: "$0.00",
        trialPeriodYearlyPrice: "$0.00",
      });
    });

    it("a trial with no price counts as free", () => {
      const withoutPrice = productVariables({
        ...annual,
        subscription: { period: "year", period_count: 1, trial_period_days: 30 },
      });
      const withoutAmount = productVariables({
        ...annual,
        trial_price: { currency: "USD" },
        subscription: { period: "year", period_count: 1, trial_period_days: 30 },
      });

      for (const variables of [withoutPrice, withoutAmount]) {
        expect(variables).toMatchObject({
          trialPeriodDays: 30,
          trialPeriodWeeks: 4,
          trialPeriodMonths: 1,
          rawTrialPeriodPrice: 0,
          trialPeriodPrice: "$0.00",
        });
      }
    });

    it("a paid intro spreads its price over the trial's length", () => {
      const variables = productVariables({
        ...annual,
        trial_price: { amount: 199, currency: "usd" },
        subscription: { period: "year", period_count: 1, trial_period_days: 7 },
      });

      expect(variables).toMatchObject({
        rawTrialPeriodPrice: 1.99,
        trialPeriodPrice: "$1.99",
        trialPeriodDailyPrice: "$0.28",
        trialPeriodWeeklyPrice: "$2.00",
        trialPeriodMonthlyPrice: "$8.65",
        trialPeriodYearlyPrice: "$103.76",
      });
    });

    // FeedbackRequest #2 (report 8): App Store product 012b_pro_annual_80_30dt_3,
    // $79.99/year with a $2.99 30-day intro. The products API sends amounts in
    // minor units (ProductMapper's majorToMinorUnits), so 7999 and 299.
    describe("the reported 30-day intro on $79.99/year", () => {
      const reported = (trialAmount: number) =>
        productVariables({
          identifier: "012b_pro_annual_80_30dt_3",
          price: { amount: 7999, currency: "USD" },
          trial_price: { amount: trialAmount, currency: "USD" },
          subscription: { period: "year", period_count: 1, trial_period_days: 30 },
        });
      const length = {
        price: "$79.99",
        rawPrice: 79.99,
        trialPeriodDays: 30,
        trialPeriodWeeks: 4,
        trialPeriodMonths: 1,
        trialPeriodYears: 0,
        trialPeriodText: "30-day",
      };

      it("paid ($2.99) carries its intro price, spread over the 30 days", () => {
        expect(reported(299)).toMatchObject({
          ...length,
          rawTrialPeriodPrice: 2.99,
          trialPeriodPrice: "$2.99",
          trialPeriodDailyPrice: "$0.10",
          trialPeriodWeeklyPrice: "$0.70",
          trialPeriodMonthlyPrice: "$3.03",
          trialPeriodYearlyPrice: "$36.38",
        });
      });

      it("free ($0) carries 0 and $0.00, so a price-guarded free-trial CTA previews", () => {
        expect(reported(0)).toMatchObject({
          ...length,
          rawTrialPeriodPrice: 0,
          trialPeriodPrice: "$0.00",
          trialPeriodDailyPrice: "$0.00",
          trialPeriodWeeklyPrice: "$0.00",
          trialPeriodMonthlyPrice: "$0.00",
          trialPeriodYearlyPrice: "$0.00",
        });
      });
    });

    it("a paid trial in another currency is dropped rather than shown in the wrong one", () => {
      const otherCurrency = productVariables({
        ...annual,
        trial_price: { amount: 199, currency: "EUR" },
        subscription: { period: "year", period_count: 1, trial_period_days: 7 },
      });
      const noCurrency = productVariables({
        ...annual,
        trial_price: { amount: 199 },
        subscription: { period: "year", period_count: 1, trial_period_days: 7 },
      });

      expect(trialKeys(otherCurrency)).toEqual([]);
      expect(trialKeys(noCurrency)).toEqual([]);
      expect(otherCurrency.price).toBe("$59.99");
    });

    it("a free trial is kept whatever currency it was stored in", () => {
      const variables = productVariables({
        ...annual,
        trial_price: { amount: 0, currency: "EUR" },
        subscription: { period: "year", period_count: 1, trial_period_days: 3 },
      });

      expect(variables).toMatchObject({ trialPeriodDays: 3, trialPeriodPrice: "$0.00" });
    });

    it("a trial of zero days is no trial", () => {
      const variables = productVariables({
        ...annual,
        trial_price: { amount: 0, currency: "USD" },
        subscription: { period: "year", period_count: 1, trial_period_days: 0 },
      });

      expect(trialKeys(variables)).toEqual([]);
    });
  });

  it("reads amounts in the currency's own minor units", () => {
    const yen = productVariables({
      price: { amount: 1200, currency: "JPY" },
      trial_price: { amount: 300, currency: "JPY" },
      subscription: { period: "month", period_count: 1, trial_period_days: 7 },
    });
    expect(yen).toMatchObject({
      price: "¥1,200",
      rawPrice: 1200,
      rawTrialPeriodPrice: 300,
      trialPeriodPrice: "¥300",
    });

    const dinar = productVariables({
      price: { amount: 1500, currency: "KWD" },
      subscription: { period: "month", period_count: 1 },
    });
    expect(dinar.rawPrice).toBe(1.5);
    expect(dinar.price).toMatch(/^KWD\s1\.500$/);
  });

  it("treats a currency code Intl cannot read as two decimals", () => {
    const variables = productVariables({
      price: { amount: 1234, currency: "US" },
    });
    expect(variables).toMatchObject({ price: "12.34", rawPrice: 12.34, currencySymbol: "" });
  });
});
