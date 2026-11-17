import { LoadingOverlay } from "./sheet/LoadingOverlay";
import { Sheet } from "./sheet/Sheet";
import { SheetProvider } from "./sheet/state";
import { useAutoPrefetch } from "./hooks/useAutoPrefetch";
import { useCheckoutCompletion } from "./hooks/useCheckoutCompletion";
import { useHostDiscount } from "./hooks/useHostDiscount";
import { useIdentityRefresh } from "./hooks/useIdentityRefresh";
import { useWebCheckoutBridge } from "./hooks/useWebCheckoutBridge";

const HostDriven = () => {
  useAutoPrefetch();
  useIdentityRefresh();
  useCheckoutCompletion();
  useHostDiscount();
  useWebCheckoutBridge();
  return null;
};

export const SuperwallCheckout = () => (
  <SheetProvider>
    <HostDriven />
    <LoadingOverlay />
    <Sheet />
  </SheetProvider>
);

export { TeleportScreen } from "./teleport/TeleportScreen";
export { markTeleportScriptStart } from "./teleport/timing";
export { checkoutEvents } from "./events";
export type { CheckoutEventPayload, CheckoutEventType } from "./events";
export type { ApplePayOutcome } from "./applePay";
export type { CheckoutFailure, CheckoutFailureReason } from "./failure";
export type {
  AppliedDiscount,
  ApplePaySession,
  DiscountedProductPrice,
  ElementsCheckoutSession,
  EmbeddedCheckoutSession,
  PaymentSession,
  SubscriptionDetails,
} from "./types";
export { Checkout } from "./elements/Checkout";
export type { CheckoutElementsOptions, CheckoutProps } from "./elements/Checkout";
export { useCheckout } from "./elements/useCheckout";
export type {
  CheckoutAmounts,
  CheckoutSubmitResult,
  CheckoutUnavailableReason,
  UseCheckoutResult,
} from "./elements/useCheckout";
export type { CheckoutError } from "./elements";
export { PurchaseButton } from "./elements/PurchaseButton";
export type { PurchaseButtonProps } from "./elements/PurchaseButton";
export { ExpressCheckoutElement } from "./elements/ExpressCheckoutElement";
export type { ExpressCheckoutElementProps } from "./elements/ExpressCheckoutElement";
export {
  AddressElement,
  LinkAuthenticationElement,
  PaymentElement,
  PaymentMethodMessagingElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
export type {
  AddressElementProps,
  LinkAuthenticationElementProps,
  PaymentElementProps,
  PaymentMethodMessagingElementProps,
} from "@stripe/react-stripe-js";
