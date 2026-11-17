import type { CheckoutFailure } from "./failure";
import type { SuperwallProduct, SuperwallPurchaseFailure } from "@superwall/runtime";
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

export type PurchaseAttempt = {
  lead?: PurchaseAttempt;
  members?: Set<PurchaseAttempt>;
  failure?: CheckoutFailure;
  settled?: boolean;
};

export const leadOf = (attempt: PurchaseAttempt): PurchaseAttempt => attempt.lead ?? attempt;

export const joinAttempt = (
  lead: PurchaseAttempt | undefined,
  joiner: PurchaseAttempt | undefined,
) => {
  if (lead === undefined || joiner === undefined) return;
  const head = leadOf(lead);
  const other = leadOf(joiner);
  if (other === head) return;
  head.members ??= new Set([head]);
  for (const member of other.members ?? [other]) {
    head.members.add(member);
    member.lead = head;
  }
  delete other.members;
};

export const sameAttempt = (listening: PurchaseAttempt, reported: PurchaseAttempt | undefined) =>
  reported !== undefined && (reported === listening || leadOf(reported) === leadOf(listening));

type Attempted = { referenceName: string; attempt?: PurchaseAttempt; product?: SuperwallProduct };

export type PurchaseEventPayload = {
  start: Attempted;
  submit: Attempted;
  complete: Attempted;
  abandon: Attempted;
  failure: Attempted & { failure: CheckoutFailure | StoreFailure };
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
      [...(handlers[event] ?? [])].forEach((listener) => {
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

export type WebFailure = {
  referenceName: string;
  failure: CheckoutFailure;
  attempt?: PurchaseAttempt;
};

const webFailures = new WeakMap<object, WebFailure>();
const webFailureListeners = new WeakMap<object, Set<() => void>>();

const notifyWebFailure = (paywall: object) => {
  for (const listener of webFailureListeners.get(paywall) ?? []) listener();
};

export const reportWebFailure = (paywall: object, reported: WebFailure) => {
  if (reported.attempt !== undefined) leadOf(reported.attempt).failure = reported.failure;
  webFailures.set(paywall, reported);
  notifyWebFailure(paywall);
  purchaseEventsFor(paywall).emit("failure", reported);
};

export const clearWebFailure = (paywall: object) => {
  if (!webFailures.delete(paywall)) return;
  notifyWebFailure(paywall);
};

export const lastWebFailure = (paywall: object): WebFailure | undefined => webFailures.get(paywall);

const dismissedStoreFailures = new WeakMap<object, object>();

export const dismissStoreFailure = (paywall: object, failure: object | undefined) => {
  if (failure === undefined || dismissedStoreFailures.get(paywall) === failure) return;
  dismissedStoreFailures.set(paywall, failure);
  notifyWebFailure(paywall);
};

export const isStoreFailureDismissed = (paywall: object, failure: object | undefined): boolean =>
  failure !== undefined && dismissedStoreFailures.get(paywall) === failure;

export const subscribeWebFailure = (paywall: object, listener: () => void) => {
  const listeners = webFailureListeners.get(paywall) ?? new Set<() => void>();
  webFailureListeners.set(paywall, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
