import { LoadingOverlay } from "./sheet/LoadingOverlay";
import { Sheet } from "./sheet/Sheet";
import { SheetProvider } from "./sheet/state";
import { useAttributionRefresh } from "./hooks/useAttributionRefresh";
import { useAutoPrefetch } from "./hooks/useAutoPrefetch";
import { useCheckoutCompletion } from "./hooks/useCheckoutCompletion";
import { useHostDiscount } from "./hooks/useHostDiscount";
import { useIdentityRefresh } from "./hooks/useIdentityRefresh";
import { useWebCheckoutBridge } from "./hooks/useWebCheckoutBridge";

const HostDriven = () => {
  useAttributionRefresh();
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
export { useCheckout } from "./form/useCheckout";
export type {
  CheckoutAmounts,
  CheckoutSubmitResult,
  CheckoutUnavailableReason,
  UseCheckoutResult,
} from "./form/useCheckout";
export type { CheckoutError } from "./elements";
export { PurchaseButton } from "./form/PurchaseButton";
export type { PurchaseButtonProps } from "./form/PurchaseButton";
