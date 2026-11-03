import * as React from "react";
import { SheetShell } from "./SheetShell";
import { SheetCard } from "./SheetCard";
import { embeddedCheckouts, type EmbeddedHandlers } from "./embedded";
import { useSheetActions, useSheetState } from "./state";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { checkoutEvents } from "../events";
import type { EmbeddedCheckoutSession } from "../types";
import "./checkout.css";

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
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);

  React.useEffect(() => () => setProcessing(false), [session.clientSecret, setProcessing]);

  const handlers = React.useRef<EmbeddedHandlers>({
    onComplete: () => {},
    onAnalyticsEvent: () => {},
    onError: () => {},
  });
  handlers.current = {
    onComplete: () => {
      setProcessing(false);
      onSuccess(session);
    },
    onAnalyticsEvent: (event) => {
      if (event.eventType === "checkoutRendered") {
        checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: session.clientSecret });
      } else if (event.eventType === "checkoutSubmitted") {
        checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session });
        setProcessing(true);
      } else if (event.eventType === "checkoutSubmitFailed") {
        setProcessing(false);
        onError(new Error("Checkout submit failed"), session);
      }
    },
    onError: (error) => {
      console.error("[checkout] Stripe's embedded checkout failed:", error);
      checkoutEvents.dispatch("EMBEDDED_ERROR", { clientSecret: session.clientSecret, error });
    },
  };

  const { clientSecret, publishableKey } = session;
  React.useEffect(() => {
    if (!element) return;
    return embeddedCheckouts.show({ session: { clientSecret, publishableKey }, element, handlers });
  }, [element, clientSecret, publishableKey]);

  return (
    <SheetShell open={isOpen} onClose={onClose} largeViewport={largeViewport}>
      <SheetCard open={isOpen} onClose={onClose} largeViewport={largeViewport}>
        <div ref={setElement} className="checkout-embedded" />
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
