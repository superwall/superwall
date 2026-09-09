import type { StripeExpressCheckoutElementOptions } from "@stripe/stripe-js";
import type { SubscriptionDetails } from "../types";

export type ApplePayOption = NonNullable<StripeExpressCheckoutElementOptions["applePay"]>;
type ApplePayRecurringPaymentRequest = NonNullable<
  Extract<ApplePayOption, { recurringPaymentRequest: object }>["recurringPaymentRequest"]
>;
type ApplePayIntervalUnit = NonNullable<
  ApplePayRecurringPaymentRequest["regularBilling"]["recurringPaymentIntervalUnit"]
>;

export type ApplePayLineItem = {
  label: string;
  amount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toApplePayInterval = (
  details: SubscriptionDetails,
): { unit: ApplePayIntervalUnit; count: number } => {
  const intervalCount = details.intervalCount || 1;
  if (details.interval === "week") return { unit: "day", count: intervalCount * 7 };
  return { unit: details.interval, count: intervalCount };
};

const paymentDescriptionOf = (details: SubscriptionDetails): string => {
  const intervalCount = details.intervalCount || 1;
  if (details.interval === "week") {
    return intervalCount === 1 ? "Subscribe weekly" : `Subscribe every ${intervalCount} weeks`;
  }
  return intervalCount > 1
    ? `Subscribe every ${intervalCount} ${details.interval}s`
    : `Subscribe ${details.interval}ly`;
};

const recurringAmountOf = (details: SubscriptionDetails): number =>
  details.discount?.duration === "forever" && typeof details.discountedAmount === "number"
    ? details.discountedAmount
    : details.amount;

const trialLabelOf = (trialDays: number, isFree: boolean): string => {
  const period = `${trialDays}-Day`;
  return isFree ? `${period} Free Trial` : `${period} Intro Offer`;
};

/**
 * The `applePay` option for Stripe's PaymentRequest.
 *
 * Trials and intro offers are modelled the way Apple's own recurring demo does
 * it (https://applepaydemo.apple.com): one `recurringPaymentRequest` whose
 * `trialBilling` line ends on the trial end date and whose `regularBilling`
 * line starts on that same date. A zero-amount trial line is what makes the
 * sheet present the purchase as a free trial rather than as a payment due on
 * a future date; a paid intro offer puts the intro price on that line.
 */
export const buildApplePayConfig = (
  details: SubscriptionDetails,
  managementURL: string,
  now: Date = new Date(),
): ApplePayOption => {
  const label = details.productName || "Subscribe";
  const { unit, count } = toApplePayInterval(details);
  const trialDays = details.trialPeriodDays;

  const regularBilling = {
    label,
    amount: recurringAmountOf(details),
    recurringPaymentIntervalUnit: unit,
    recurringPaymentIntervalCount: count,
  };

  if (!trialDays || trialDays <= 0) {
    return {
      recurringPaymentRequest: {
        paymentDescription: paymentDescriptionOf(details),
        managementURL,
        regularBilling,
      },
    };
  }

  const trialEndDate = new Date(now.getTime() + trialDays * DAY_MS);
  const trialAmount = details.amountDueNow ?? 0;

  return {
    recurringPaymentRequest: {
      paymentDescription: paymentDescriptionOf(details),
      managementURL,
      trialBilling: {
        label: trialLabelOf(trialDays, trialAmount === 0),
        amount: trialAmount,
        recurringPaymentEndDate: trialEndDate,
      },
      regularBilling: { ...regularBilling, recurringPaymentStartDate: trialEndDate },
    },
  };
};

/**
 * Line items that explain the sheet total when a promotion code is applied:
 * the product at full price and the code as a negative amount. Nothing when
 * there is nothing to explain — no code, or a trial session, where the total
 * is the trial amount and the discount lands on a later invoice.
 */
export const buildApplePayLineItems = (
  details: SubscriptionDetails,
): ApplePayLineItem[] | undefined => {
  const { amount, discountedAmount, discount, trialPeriodDays } = details;
  if (trialPeriodDays && trialPeriodDays > 0) return undefined;
  if (!discount?.code || typeof discountedAmount !== "number") return undefined;
  if (discountedAmount >= amount) return undefined;

  return [
    { label: details.productName || "Subscribe", amount },
    { label: `Code ${discount.code}`, amount: discountedAmount - amount },
  ];
};
