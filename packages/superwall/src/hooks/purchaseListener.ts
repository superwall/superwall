import type { SuperwallProduct } from "@superwall/runtime";
import {
  purchaseEventsFor,
  sameAttempt,
  type PurchaseAttempt,
  type PurchaseEventPayload,
} from "../checkout/events";
import type { PurchaseCallbacks, PurchaseFailure } from "./usePurchase";

export const listenToPurchases = <TProduct extends SuperwallProduct>(
  paywall: { getSnapshot: () => { productsByReference: Record<string, TProduct | undefined> } },
  callbacks: () => PurchaseCallbacks<TProduct>,
  only?: PurchaseAttempt,
): (() => void) => {
  const events = purchaseEventsFor(paywall);
  const productOf = ({ referenceName, attempt, product }: PurchaseEventPayload["start"]) =>
    only === undefined || sameAttempt(only, attempt)
      ? ((product as TProduct | undefined) ??
        paywall.getSnapshot().productsByReference[referenceName])
      : undefined;
  const each =
    (pick: (current: PurchaseCallbacks<TProduct>) => ((product: TProduct) => void) | undefined) =>
    (payload: PurchaseEventPayload["start"]) => {
      const product = productOf(payload);
      if (product) pick(callbacks())?.(product);
    };
  
  const unsubscribers = [
    events.on(
      "start",
      each((current) => current.onStart),
    ),
    events.on(
      "submit",
      each((current) => current.onSubmit),
    ),
    events.on(
      "complete",
      each((current) => current.onComplete),
    ),
    events.on(
      "abandon",
      each((current) => current.onAbandon),
    ),
    events.on("failure", (payload) => {
      const { failure } = payload;
      const product = productOf(payload);
      if (product) {
        callbacks().onFailure?.({
          ...failure,
          status: "failed",
          product,
        } as PurchaseFailure<TProduct>);
      }
    }),
  ];
  
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
};
