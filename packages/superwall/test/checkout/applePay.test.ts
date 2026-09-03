import { describe, expect, it } from "vitest";
import { buildApplePayConfig, buildApplePayLineItems } from "../../src/checkout/utils/applePay";
import type { SubscriptionDetails } from "../../src/checkout/state/types";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const MANAGE = "https://example.superwall.app/manage";

const monthly: SubscriptionDetails = {
  amount: 499,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  productName: "Premium",
};

const discount = { code: "SAVE20", promotionCodeId: "promo_1", couponId: "c_1" };

describe("buildApplePayConfig", () => {
  it("describes a plain subscription as a recurring payment", () => {
    expect(buildApplePayConfig(monthly, MANAGE, NOW)).toEqual({
      recurringPaymentRequest: {
        paymentDescription: "Subscribe monthly",
        managementURL: MANAGE,
        regularBilling: {
          label: "Premium",
          amount: 499,
          recurringPaymentIntervalUnit: "month",
          recurringPaymentIntervalCount: 1,
        },
      },
    });
  });

  it("expresses weekly plans in days because Apple Pay has no week unit", () => {
    const config = buildApplePayConfig(
      { ...monthly, interval: "week", intervalCount: 2 },
      MANAGE,
      NOW,
    );
    expect(config.recurringPaymentRequest?.paymentDescription).toBe("Subscribe every 2 weeks");
    expect(config.recurringPaymentRequest?.regularBilling).toMatchObject({
      recurringPaymentIntervalUnit: "day",
      recurringPaymentIntervalCount: 14,
    });
  });

  it("models a free trial as a zero-amount trial line followed by regular billing", () => {
    const trialEnd = new Date("2026-09-10T12:00:00.000Z");
    expect(
      buildApplePayConfig({ ...monthly, trialPeriodDays: 7, amountDueNow: 0 }, MANAGE, NOW),
    ).toEqual({
      recurringPaymentRequest: {
        paymentDescription: "Subscribe monthly",
        managementURL: MANAGE,
        trialBilling: { label: "7-Day Free Trial", amount: 0, recurringPaymentEndDate: trialEnd },
        regularBilling: {
          label: "Premium",
          amount: 499,
          recurringPaymentIntervalUnit: "month",
          recurringPaymentIntervalCount: 1,
          recurringPaymentStartDate: trialEnd,
        },
      },
    });
  });

  it("puts the intro price on the trial line for a paid intro offer", () => {
    const config = buildApplePayConfig(
      { ...monthly, amount: 2000, amountDueNow: 499, trialPeriodDays: 3 },
      MANAGE,
      NOW,
    );
    expect(config.recurringPaymentRequest?.trialBilling).toMatchObject({
      label: "3-Day Intro Offer",
      amount: 499,
    });
    expect(config.recurringPaymentRequest?.regularBilling.amount).toBe(2000);
  });

  it("uses the discounted recurring amount only for forever coupons", () => {
    const forever = buildApplePayConfig(
      { ...monthly, discountedAmount: 399, discount: { ...discount, duration: "forever" } },
      MANAGE,
      NOW,
    );
    const once = buildApplePayConfig(
      { ...monthly, discountedAmount: 399, discount: { ...discount, duration: "once" } },
      MANAGE,
      NOW,
    );
    expect(forever.recurringPaymentRequest?.regularBilling.amount).toBe(399);
    expect(once.recurringPaymentRequest?.regularBilling.amount).toBe(499);
  });

  it("falls back to a generic label without a product name", () => {
    const config = buildApplePayConfig({ ...monthly, productName: undefined }, MANAGE, NOW);
    expect(config.recurringPaymentRequest?.regularBilling.label).toBe("Subscribe");
  });
});

describe("buildApplePayLineItems", () => {
  it("returns nothing without a promotion code", () => {
    expect(buildApplePayLineItems(monthly)).toBeUndefined();
  });

  it("explains a discounted total with the full price and a negative code line", () => {
    expect(
      buildApplePayLineItems({
        ...monthly,
        amountDueNow: 399,
        discountedAmount: 399,
        discount: { ...discount, duration: "once" },
      }),
    ).toEqual([
      { label: "Premium", amount: 499 },
      { label: "Code SAVE20", amount: -100 },
    ]);
  });

  it("returns nothing on trial sessions, where the discount lands on a later invoice", () => {
    expect(
      buildApplePayLineItems({
        ...monthly,
        trialPeriodDays: 7,
        amountDueNow: 0,
        discountedAmount: 399,
        discount,
      }),
    ).toBeUndefined();
  });

  it("returns nothing when the code does not lower the price", () => {
    expect(buildApplePayLineItems({ ...monthly, discountedAmount: 499, discount })).toBeUndefined();
  });
});
