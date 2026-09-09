import * as React from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { SheetShell } from "./SheetShell";
import { SheetCard } from "./SheetCard";
import { useSheetActions, useSheetState } from "./state";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { checkoutEvents } from "../events";
import type { EmbeddedCheckoutSession } from "../types";
import "./checkout.css";

const stripeByKey = new Map<string, Promise<Stripe | null>>();

const stripeFor = (publishableKey: string): Promise<Stripe | null> => {
  const cached = stripeByKey.get(publishableKey);
  if (cached) return cached;
  const loaded = loadStripe(publishableKey, { developerTools: { assistant: { enabled: false } } });
  stripeByKey.set(publishableKey, loaded);
  return loaded;
};

type StripeSheetProps = {
  session: EmbeddedCheckoutSession;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: EmbeddedCheckoutSession) => void;
  onError: (error: Error, session: EmbeddedCheckoutSession) => void;
};

const StripeSheet = ({ session, isOpen, onClose, onSuccess, onError }: StripeSheetProps) => {
  const largeViewport = useMediaQuery("(min-width: 650px)");
  const { setProcessing } = useSheetActions();
  const stripe = React.useMemo(() => stripeFor(session.publishableKey), [session.publishableKey]);

  const handlers = React.useRef({ onSuccess, onError });
  handlers.current = { onSuccess, onError };

  React.useEffect(() => () => setProcessing(false), [session.clientSecret, setProcessing]);

  const options = React.useMemo(
    () => ({
      clientSecret: session.clientSecret,
      onComplete: () => {
        setProcessing(false);
        handlers.current.onSuccess(session);
      },
      onAnalyticsEvent: (event: { eventType: string }) => {
        if (event.eventType === "checkoutRendered") {
          checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: session.clientSecret });
        } else if (event.eventType === "checkoutSubmitted") {
          checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session });
          setProcessing(true);
        } else if (event.eventType === "checkoutSubmitFailed") {
          setProcessing(false);
          handlers.current.onError(new Error("Checkout submit failed"), session);
        }
      },
    }),
    [session, setProcessing],
  );

  return (
    <SheetShell open={isOpen} onClose={onClose} largeViewport={largeViewport}>
      <SheetCard open={isOpen} onClose={onClose} largeViewport={largeViewport}>
        <EmbeddedCheckoutProvider stripe={stripe} options={options}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </SheetCard>
    </SheetShell>
  );
};

export const Sheet = () => {
  const { closeSheet, removeSession, setError } = useSheetActions();
  const { isOpen, activeSession, pooledSessions, isProcessing } = useSheetState();

  const handleClose = () => {
    if (isProcessing) return;
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    closeSheet();
  };

  const handleSuccess = (session: EmbeddedCheckoutSession) => {
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    closeSheet();
    removeSession(session.clientSecret);
  };

  const handleError = (error: Error, session: EmbeddedCheckoutSession) => {
    checkoutEvents.dispatch("PAYMENT_ERROR", { error, session });
    setError(error);
  };

  const session = activeSession ?? pooledSessions.values().next().value;
  if (!session) return null;

  return (
    <StripeSheet
      key={session.clientSecret}
      session={session}
      isOpen={isOpen && activeSession !== null}
      onClose={handleClose}
      onSuccess={handleSuccess}
      onError={handleError}
    />
  );
};
