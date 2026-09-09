import type { EmbeddedCheckoutSession, PaymentSession } from "./types";

export type CheckoutEventType =
  | "SESSION_CREATED"
  | "SHEET_OPEN"
  | "SHEET_CLOSE"
  | "EMBEDDED_READY"
  | "CHECKOUT_SUBMITTED"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_ERROR"
  | "SESSION_INVALIDATED";

export type CheckoutEventPayload = {
  SESSION_CREATED: EmbeddedCheckoutSession;
  SHEET_OPEN: { session: EmbeddedCheckoutSession };
  SHEET_CLOSE: undefined;
  EMBEDDED_READY: { clientSecret: string };
  CHECKOUT_SUBMITTED: { session: PaymentSession };
  PAYMENT_SUCCESS: { session: PaymentSession };
  PAYMENT_ERROR: { error: Error; session: PaymentSession };
  SESSION_INVALIDATED: { reason?: string };
};

type Listener<T extends CheckoutEventType> = (payload: CheckoutEventPayload[T]) => void;

type Listeners = { [T in CheckoutEventType]?: Set<Listener<T>> };

const listeners: Listeners = {};

export const checkoutEvents = {
  subscribe: <T extends CheckoutEventType>(event: T, listener: Listener<T>): (() => void) => {
    const set = listeners[event] ?? new Set<Listener<T>>();
    if (!listeners[event]) Object.assign(listeners, { [event]: set });
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  },
  dispatch: <T extends CheckoutEventType>(event: T, payload: CheckoutEventPayload[T]): void => {
    listeners[event]?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[checkout] ${event} listener failed:`, error);
      }
    });
  },
};
