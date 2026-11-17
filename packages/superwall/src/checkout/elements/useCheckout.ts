import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import type { CheckoutFailure } from "../failure";
import type { AppliedDiscount } from "../types";
import type { WebCheckoutResult } from "../../hooks/usePurchase";
import type { CheckoutError } from "./index";

/**
 * Why a `<Checkout>` cannot take payment.
 *
 * - `"unsupported_host"`: this host never takes payment in the paywall:
 *   inside the iOS app, in Studio, or in an SDK older than 4.10.8.
 * - `"external_checkout"`: the config's `checkout` sends shoppers to
 *   Superwall's hosted checkout. Set it to `"elements"`.
 * - `"missing_public_api_key"`: the host supplied no public API key.
 * - `"unknown_product"`: the paywall has no product with this reference.
 * - `"not_stripe_product"`: the product is sold by the App Store or Play
 *   Store, not Stripe. Buy it with `usePurchase().purchase()`.
 * - `"session_failed"`: fetching the product's checkout failed; `error`
 *   holds it.
 * - `"session_unsupported"`: the backend can't take this product's payment
 *   in a form, such as a one-time price.
 * - `"stripe_load_failed"`: Stripe.js did not load.
 */
export type CheckoutUnavailableReason =
  | "unsupported_host"
  | "external_checkout"
  | "missing_public_api_key"
  | "unknown_product"
  | "not_stripe_product"
  | "session_failed"
  | "session_unsupported"
  | "stripe_load_failed";

/** What the shopper pays, in the currency's minor units (cents for USD). */
export type CheckoutAmounts = {
  /** The ISO 4217 currency code, lowercase, such as `"usd"`. */
  currency: string;
  /** What the shopper pays today: `0` during a free trial. */
  dueNow: number;
  /** What each period renews at, after any discount. */
  recurring: number;
  /** The renewal period's unit. */
  interval: "day" | "week" | "month" | "year";
  /** How many `interval`s one period lasts. */
  intervalCount: number;
  /** The free trial's length in days. Absent without a trial. */
  trialDays?: number;
  /** The discount applied with `useDiscount`. Absent without one. */
  discount?: AppliedDiscount;
};

/**
 * How a `submit()` ended. `completed`, `abandoned` and `failed` are a
 * purchase, reported to every callback like any other. `incomplete` means
 * the form is not filled in: Stripe already shows the shopper what is
 * missing, and no purchase started. `unavailable` means the form cannot
 * take payment; see `reason`.
 */
export type CheckoutSubmitResult<TProduct extends SuperwallProduct = SuperwallProduct> =
  | WebCheckoutResult<TProduct>
  | {
      status: "incomplete";
      product: TProduct;
      /** What Stripe said is missing. */
      error: CheckoutError;
    }
  | {
      status: "unavailable";
      product?: TProduct;
      reason: CheckoutUnavailableReason | "preparing" | "paying";
    };

/**
 * The state of the nearest `<Checkout>`.
 *
 * - `"preparing"`: Stripe and the product's price are loading.
 * - `"ready"`: the shopper can pay.
 * - `"paying"`: a payment is in flight.
 * - `"unavailable"`: the form cannot take payment; `reason` says why.
 */
export type UseCheckoutResult<TProduct extends SuperwallProduct = SuperwallProduct> = {
  status: "preparing" | "ready" | "paying" | "unavailable";
  /** Why the form cannot take payment. Set only when `status` is `"unavailable"`. */
  reason?: CheckoutUnavailableReason;
  /** The reason in a sentence, in English, for logs and debugging. Set with `reason`. */
  message?: string;
  /** What the browser or Stripe threw, when a step threw. */
  error?: CheckoutError;
  /** The product the form sells. Absent when the paywall has no such product. */
  product?: TProduct;
  /** What the shopper pays. Absent until the product's price has loaded. */
  amounts?: CheckoutAmounts;
  /**
   * `"SetupIntent"` when the shopper pays nothing today (a free trial),
   * `"PaymentIntent"` otherwise. Absent until the price has loaded.
   */
  intentType?: "SetupIntent" | "PaymentIntent";
  /** Whether `submit()` can pay now: `status` is `"ready"`. */
  canSubmit: boolean;
  /**
   * Pays for the product with what the shopper entered in the form's
   * `PaymentElement`. Bind it to your own button, or use `<PurchaseButton>`.
   */
  submit: () => Promise<CheckoutSubmitResult<TProduct>>;
  /** Why the form's last payment failed, cleared when the next one starts. */
  failure?: CheckoutFailure;
};

export type ExpressHandlers = {
  onClick: (event: { resolve: () => void; reject: () => void }) => void;
  onConfirm: (event: { paymentFailed: (payload?: { reason?: "fail" }) => void }) => Promise<void>;
  onCancel: () => void;
};

export type CheckoutContextValue = { checkout: UseCheckoutResult; express: ExpressHandlers };

export const CheckoutContext = React.createContext<CheckoutContextValue | null>(null);

export const useCheckoutContext = (caller: string): CheckoutContextValue => {
  const value = React.useContext(CheckoutContext);
  if (value === null) throw new Error(`${caller} must be rendered inside <Checkout>.`);
  return value;
};

/**
 * The state of the nearest `<Checkout>`, and `submit()` to pay with what the
 * shopper entered. Call it from any component inside `<Checkout>`:
 *
 * ```tsx
 * const PayButton = () => {
 *   const checkout = useCheckout();
 *   return (
 *     <button disabled={!checkout.canSubmit} onClick={() => checkout.submit()}>
 *       {checkout.status === "paying" ? "Paying…" : "Subscribe"}
 *     </button>
 *   );
 * };
 * ```
 */
export const useCheckout = <
  TProduct extends SuperwallProduct = SuperwallProduct,
>(): UseCheckoutResult<TProduct> => {
  return useCheckoutContext("useCheckout()").checkout as UseCheckoutResult<TProduct>;
};
