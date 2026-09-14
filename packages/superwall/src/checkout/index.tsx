import { LoadingOverlay } from "./sheet/LoadingOverlay";
import { Sheet } from "./sheet/Sheet";
import { SheetProvider } from "./sheet/state";
import { useAutoPrefetch } from "./hooks/useAutoPrefetch";
import { useCheckoutCompletion } from "./hooks/useCheckoutCompletion";
import { useHostDiscount } from "./hooks/useHostDiscount";
import { useIdentityRefresh } from "./hooks/useIdentityRefresh";

const HostDriven = () => {
  useAutoPrefetch();
  useIdentityRefresh();
  useCheckoutCompletion();
  useHostDiscount();
  return null;
};

export const SuperwallCheckout = () => (
  <SheetProvider>
    <HostDriven />
    <LoadingOverlay />
    <Sheet />
  </SheetProvider>
);

export { checkoutEvents } from "./events";
export type { CheckoutEventPayload, CheckoutEventType } from "./events";
export type { ApplePayOutcome } from "./applePay";
export type {
  AppliedDiscount,
  ApplePaySession,
  DiscountedProductPrice,
  ElementsCheckoutSession,
  EmbeddedCheckoutSession,
  PaymentSession,
  SubscriptionDetails,
} from "./types";
