import {
  ExpressCheckoutElement as StripeExpressCheckoutElement,
  type ExpressCheckoutElementProps as StripeExpressCheckoutElementProps,
} from "@stripe/react-stripe-js";
import { useCheckoutContext } from "./useCheckout";

/**
 * Stripe's props for the Express Checkout Element, without the payment
 * events: `<Checkout>` handles `onClick`, `onConfirm` and `onCancel`, and
 * reports them through its callbacks.
 */
export type ExpressCheckoutElementProps = Omit<
  StripeExpressCheckoutElementProps,
  "onClick" | "onConfirm" | "onCancel"
>;

/**
 * Stripe's Express Checkout Element, paying through the nearest
 * `<Checkout>`: one-tap buttons for Apple Pay, Google Pay and Link, each
 * shown where the shopper's device and browser offer it. A wallet payment
 * completes the purchase without a `<PurchaseButton>`; closing the wallet
 * reports an abandon.
 */
export const ExpressCheckoutElement = (props: ExpressCheckoutElementProps) => {
  const { express } = useCheckoutContext("<ExpressCheckoutElement>");
  return (
    <StripeExpressCheckoutElement
      {...props}
      onClick={express.onClick}
      onConfirm={express.onConfirm}
      onCancel={express.onCancel}
    />
  );
};
