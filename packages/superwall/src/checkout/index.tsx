import { CheckoutProvider } from "./state/CheckoutContext";
import { CheckoutSheet } from "./components/CheckoutSheet";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { useAutoPrefetch } from "./hooks/useAutoPrefetch";
import "./checkout.css";

const AutoPrefetch = () => {
  useAutoPrefetch();
  return null;
};

/**
 * Takes payment inside the paywall.
 *
 * Mounted by the build for paywalls whose config asks for `sheet` or
 * `applePay`, so a paywall that sells through the store never carries any of
 * it. It renders nothing until a purchase opens it.
 *
 * The sheet looks the same on every Superwall paywall, by design: it takes no
 * colors, fonts, or spacing from the page around it, and there is no prop to
 * make it. Payment UI that can be restyled is payment UI a shopper cannot
 * recognize.
 */
export const SuperwallCheckout = () => (
  <CheckoutProvider>
    <AutoPrefetch />
    <LoadingOverlay />
    <CheckoutSheet />
  </CheckoutProvider>
);

export { CheckoutProvider, useCheckoutState, useCheckoutActions } from "./state/CheckoutContext";
export { checkoutEvents } from "./services/CheckoutEvents";
export type {
  AppliedDiscount,
  ApplePaySessionData,
  CheckoutEventPayload,
  CheckoutEventType,
  CheckoutSessionData,
  DiscountedProductPrice,
  ElementsCheckoutSession,
  SessionData,
  SubscriptionDetails,
} from "./state/types";
export type { ApplePayOutcome } from "./services/ApplePayCheckoutController";
