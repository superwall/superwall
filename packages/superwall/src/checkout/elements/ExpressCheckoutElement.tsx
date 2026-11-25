import * as React from "react";
import {
  ExpressCheckoutElement as StripeExpressCheckoutElement,
  type ExpressCheckoutElementProps as StripeExpressCheckoutElementProps,
} from "@stripe/react-stripe-js";

export type ExpressHandlers = {
  onClick: (event: {
    resolve: (details?: { emailRequired?: boolean }) => void;
    reject: () => void;
  }) => void;
  onConfirm: (event: {
    paymentFailed: (payload?: { reason?: "fail" }) => void;
    billingDetails?: { email?: string | null };
  }) => Promise<void>;
  onCancel: () => void;
  register: () => () => void;
};

export const ExpressContext = React.createContext<ExpressHandlers | null>(null);

/**
 * Stripe's props for the Express Checkout Element, without the payment
 * events: `<StripeCheckout>` handles `onClick`, `onConfirm` and `onCancel`,
 * and reports them through its callbacks.
 */
export type ExpressCheckoutElementProps = Omit<
  StripeExpressCheckoutElementProps,
  "onClick" | "onConfirm" | "onCancel"
>;

/**
 * Stripe's Express Checkout Element, paying through the nearest
 * `<StripeCheckout>`: one-tap buttons for Apple Pay, Google Pay and Link,
 * each shown where the shopper's device and browser offer it. A wallet
 * payment completes the purchase without a `<PurchaseButton>`; closing the
 * wallet reports an abandon. The wallet always asks for the shopper's email,
 * which superwall sets on the subscription's customer.
 */
export const ExpressCheckoutElement = (props: ExpressCheckoutElementProps) => {
  const express = React.useContext(ExpressContext);
  if (express === null) {
    throw new Error("<ExpressCheckoutElement> must be rendered inside <StripeCheckout>.");
  }
  const { register } = express;
  React.useEffect(() => register(), [register]);
  return (
    <StripeExpressCheckoutElement
      {...props}
      onClick={express.onClick}
      onConfirm={express.onConfirm}
      onCancel={express.onCancel}
    />
  );
};
