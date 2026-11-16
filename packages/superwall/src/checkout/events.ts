import type { CheckoutFailure } from "./failure";
import type { SuperwallPurchaseFailure } from "@superwall/runtime";
import type { EmbeddedCheckoutSession, PaymentSession } from "./types";

export type CheckoutEventType =
  | "SESSION_CREATED"
  | "SESSION_PREFETCHED"
  | "SHEET_OPEN"
  | "SHEET_CLOSE"
  | "EMBEDDED_READY"
  | "CHECKOUT_SUBMITTED"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_ERROR"
  | "SESSION_INVALIDATED";

export type CheckoutEventPayload = {
  SESSION_CREATED: EmbeddedCheckoutSession;
  SESSION_PREFETCHED: EmbeddedCheckoutSession;
  SHEET_OPEN: { session: EmbeddedCheckoutSession };
  SHEET_CLOSE: undefined;
  EMBEDDED_READY: { clientSecret: string };
  CHECKOUT_SUBMITTED: { session: PaymentSession };
  PAYMENT_SUCCESS: { session: PaymentSession };
  PAYMENT_ERROR: { error: Error; session: PaymentSession; failure?: CheckoutFailure };
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

type StoreFailure = { reason: SuperwallPurchaseFailure["reason"] };

export type PurchaseEventPayload = {
  start: { referenceName: string };
  submit: { referenceName: string };
  complete: { referenceName: string };
  abandon: { referenceName: string };
  failure: { referenceName: string; failure: CheckoutFailure | StoreFailure };
};

export type PurchaseEvent = keyof PurchaseEventPayload;

type PurchaseListener<T extends PurchaseEvent> = (payload: PurchaseEventPayload[T]) => void;

type PurchaseBus = {
  on<T extends PurchaseEvent>(event: T, listener: PurchaseListener<T>): () => void;
  emit<T extends PurchaseEvent>(event: T, payload: PurchaseEventPayload[T]): void;
};

const purchaseBuses = new WeakMap<object, PurchaseBus>();

export const purchaseEventsFor = (paywall: object): PurchaseBus => {
  const existing = purchaseBuses.get(paywall);
  if (existing) return existing;
  const handlers: { [T in PurchaseEvent]?: Set<PurchaseListener<T>> } = {};
  const bus: PurchaseBus = {
    on: (event, listener) => {
      const set = handlers[event] ?? new Set();
      if (!handlers[event]) Object.assign(handlers, { [event]: set });
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    emit: (event, payload) => {
      handlers[event]?.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error(`[checkout] purchase ${event} listener failed:`, error);
        }
      });
    },
  };
  purchaseBuses.set(paywall, bus);
  return bus;
};
