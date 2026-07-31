import { useState, useEffect, useMemo } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { SheetContainer } from "./SheetContainer";
import { SheetContent } from "./SheetContent";
import { useCheckoutState, useCheckoutActions } from "../state/CheckoutContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { checkoutEvents } from "../services/CheckoutEvents";
import type { SessionData } from "../state/types";

const stripePromiseCache = new Map<string, Promise<Stripe | null>>();

function EmbeddedCheckoutSheetInstance({
  session,
  isOpen,
  onClose,
  onSuccess,
  onError,
}: {
  session: SessionData;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: SessionData) => void;
  onError: (error: Error, session: SessionData) => void;
}) {
  const largeViewport = useMediaQuery("(min-width: 650px)");
  const { setProcessing } = useCheckoutActions();
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    if (session.publishableKey && !stripePromise) {
      const cached = stripePromiseCache.get(session.publishableKey);
      if (cached) {
        setStripePromise(cached);
        return;
      }

      const promise = loadStripe(session.publishableKey, {
        developerTools: { assistant: { enabled: false } },
      });
      stripePromiseCache.set(session.publishableKey, promise);
      setStripePromise(promise);
    }
  }, [session.publishableKey, session.referenceName, stripePromise]);

  useEffect(() => {
    return () => {
      setProcessing(false);
    };
  }, [session.clientSecret, setProcessing]);

  const checkoutOptions = useMemo(
    () => ({
      clientSecret: session.clientSecret,
      onComplete: () => {
        setProcessing(false);
        onSuccess(session);
      },
      onAnalyticsEvent: (event: { eventType: string }) => {
        if (event.eventType === "checkoutRendered") {
          checkoutEvents.dispatch("EMBEDDED_READY", {
            clientSecret: session.clientSecret,
          });
        } else if (event.eventType === "checkoutSubmitted") {
          checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session });
          setProcessing(true);
        } else if (event.eventType === "checkoutSubmitFailed") {
          setProcessing(false);
          onError(new Error("Checkout submit failed"), session);
        }
      },
    }),
    [session.clientSecret],
  );

  if (!stripePromise) {
    return null;
  }

  return (
    <SheetContainer open={isOpen} onClose={onClose} largeViewport={largeViewport}>
      <SheetContent open={isOpen} onClose={onClose} largeViewport={largeViewport}>
        <EmbeddedCheckoutProvider stripe={stripePromise} options={checkoutOptions}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </SheetContent>
    </SheetContainer>
  );
}

export function CheckoutSheet() {
  const { closeSheet, removeSession, setError } = useCheckoutActions();
  const { isOpen, activeSession, pooledSessions, isProcessing } = useCheckoutState();

  const handleClose = () => {
    if (isProcessing) {
      return;
    }
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    closeSheet();
  };

  const handleSuccess = (session: SessionData) => {
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    closeSheet();
    removeSession(session.clientSecret);
  };

  const handleError = (error: Error, session: SessionData) => {
    checkoutEvents.dispatch("PAYMENT_ERROR", { error, session });
    setError(error);
  };

  const sessions = Array.from(pooledSessions.values());

  const activeEmbeddedSession = activeSession?.directive === "embedded" ? activeSession : null;
  const pendingEmbeddedSession = !activeEmbeddedSession
    ? sessions.find((s) => s.directive === "embedded")
    : null;
  const embeddedSession = activeEmbeddedSession || pendingEmbeddedSession;

  if (!embeddedSession) {
    return null;
  }

  return (
    <EmbeddedCheckoutSheetInstance
      key={embeddedSession.clientSecret}
      session={embeddedSession}
      isOpen={isOpen && !!activeEmbeddedSession}
      onClose={handleClose}
      onSuccess={handleSuccess}
      onError={handleError}
    />
  );
}
