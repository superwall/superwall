import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import type { CheckoutFailure } from "../failure";
import type { AppliedDiscount } from "../types";
import type { WebCheckoutResult } from "../../hooks/usePurchase";
import type { CheckoutError } from "../elements";

/**
 * Why a checkout form, such as `<StripeCheckout>`, cannot take payment.
 *
 * - `"unsupported_host"`: this host never takes payment in the paywall:
 *   inside the iOS app, in Studio, or in an SDK older than 4.10.8.
 * - `"external_checkout"`: the config's `checkout` sends shoppers to
 *   Superwall's hosted checkout instead of a form.
 * - `"missing_public_api_key"`: the host supplied no public API key.
 * - `"unknown_product"`: the paywall has no product with this reference.
 * - `"unsupported_product"`: the form's store does not sell this product,
 *   such as an App Store product in `<StripeCheckout>`. Buy it with
 *   `usePurchase().purchase()`.
 * - `"session_failed"`: fetching the product's checkout failed; `error`
 *   holds it.
 * - `"session_unsupported"`: the backend can't take this product's payment
 *   in a form, such as a one-time price.
 * - `"store_load_failed"`: the store's script, such as Stripe.js, did not
 *   load.
 */
export type CheckoutUnavailableReason =
  | "unsupported_host"
  | "external_checkout"
  | "missing_public_api_key"
  | "unknown_product"
  | "unsupported_product"
  | "session_failed"
  | "session_unsupported"
  | "store_load_failed";

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
 * no purchase started: the form is not filled in, and its fields already
 * show the shopper what is missing, or the store refused to read the form,
 * such as when Stripe's `PaymentElement` is not mounted, and `error` says
 * why. An `error` named `"email_required"` means the form has no email for
 * the shopper: render the store's email field, such as Stripe's
 * `LinkAuthenticationElement`, or set the user's `email` attribute.
 * `unavailable` means the form cannot take payment; see `reason`.
 */
export type CheckoutSubmitResult<TProduct extends SuperwallProduct = SuperwallProduct> =
  | WebCheckoutResult<TProduct>
  | {
      status: "incomplete";
      product: TProduct;
      /** What the store said is missing, or why it could not read the form. */
      error: CheckoutError;
    }
  | {
      status: "unavailable";
      product?: TProduct;
      reason: CheckoutUnavailableReason | "preparing" | "paying";
    };

/**
 * The state of the nearest checkout form, such as `<StripeCheckout>`.
 *
 * - `"preparing"`: the store's script and the product's price are loading.
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
  /** What the browser or the store threw, when a step threw. */
  error?: CheckoutError;
  /** The product the form sells. Absent when the paywall has no such product. */
  product?: TProduct;
  /** What the shopper pays. Absent until the product's price has loaded. */
  amounts?: CheckoutAmounts;
  /** Whether `submit()` can pay now: `status` is `"ready"`. */
  canSubmit: boolean;
  /**
   * Pays for the product with what the shopper entered in the form. Bind it
   * to your own button, or use `<PurchaseButton>`.
   */
  submit: () => Promise<CheckoutSubmitResult<TProduct>>;
  /** Why the form's last payment failed, cleared when the next one starts. */
  failure?: CheckoutFailure;
};

export const CheckoutContext = React.createContext<UseCheckoutResult | null>(null);

export const useCheckoutContext = (caller: string): UseCheckoutResult => {
  const value = React.useContext(CheckoutContext);
  if (value === null) {
    throw new Error(`${caller} must be rendered inside a checkout form, such as <StripeCheckout>.`);
  }
  return value;
};

/**
 * The state of the nearest checkout form, and `submit()` to pay with what
 * the shopper entered. It reads the same for every store, so a CTA built on
 * it works in any form. Call it from any component inside one, such as
 * `<StripeCheckout>` from `superwall/checkout/stripe`:
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
  return useCheckoutContext("useCheckout()") as UseCheckoutResult<TProduct>;
};
