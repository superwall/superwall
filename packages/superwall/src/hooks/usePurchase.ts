import * as React from "react";
import type {
  SuperwallProduct,
  SuperwallProductVariables,
  SuperwallPurchaseFailure,
  SuperwallSession,
  SuperwallTransaction,
} from "@superwall/runtime";
import { checkoutModeOf } from "@superwall/runtime";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";
import type { ProductReference } from "./index";
import {
  controllerFor,
  openEmbeddedCheckout,
  prefetchSession,
} from "../checkout/services/registry";

export type UsePurchaseResult<TVariables extends SuperwallProductVariables> = {
  /**
   * Starts a purchase and resolves with the outcome — never throws for flow
   * results: `{ status: "completed" | "abandoned" | "failed" }`.
   */
  purchase: (
    input: ProductReference | SuperwallProduct<TVariables>,
    options?: Parameters<SuperwallSession<SuperwallProduct<TVariables>>["purchase"]>[1],
  ) => ReturnType<SuperwallSession<SuperwallProduct<TVariables>>["purchase"]>;
  /** True while a purchase is awaiting a transaction result. */
  isPurchasing: boolean;
  /** The product currently being purchased, if any. */
  pendingProduct?: SuperwallProduct<TVariables>;
  /** The most recent completed or abandoned transaction. */
  transaction?: SuperwallTransaction<SuperwallProduct<TVariables>>;
  /** The most recent purchase failure (timeout/superseded), cleared on the next attempt. */
  failure?: SuperwallPurchaseFailure<SuperwallProduct<TVariables>>;
  /**
   * Warms a web checkout for a Stripe product ahead of the tap: fetches the
   * session and pre-mounts Stripe's sheet hidden, so `purchase` opens it
   * instantly. A no-op for store products or paywalls without web checkout.
   * Without an argument, prefetches the paywall's first product.
   */
  prefetch: (input?: ProductReference | SuperwallProduct<TVariables>) => void;
};

/**
 * Purchase with built-in pending state — no `useState(isPurchasing)` needed.
 * React to outcomes on the awaited result, not on state:
 *
 * ```tsx
 * const { purchase, isPurchasing } = usePurchase()
 * const result = await purchase("primary")
 * if (result.status === "abandoned") showAbandonmentOffer()
 * ```
 */
export const usePurchase = <
  TVariables extends SuperwallProductVariables = SuperwallProductVariables,
>(): UsePurchaseResult<TVariables> => {
  const session = useSuperwallSession<SuperwallProduct<TVariables>>();
  const snapshot = useSuperwallSnapshot<SuperwallProduct<TVariables>>();

  const mode = checkoutModeOf(snapshot.config?.checkout);

  const purchase = React.useCallback(
    (async (input, options) => {
      const reference = typeof input === "string" ? input : input.reference;
      if (mode === "sheet" || mode === "applePay") {
        const controller = controllerFor(session);
        if (controller.isStripeProduct(reference)) {
          try {
            const result = await controller.beginCheckout({
              referenceName: reference,
              mode,
              cacheScope: mode === "applePay" ? "apple-pay" : "default",
            });
            if (result.directive === "embedded") {
              return await openEmbeddedCheckout(result);
            }
            if (result.directive === "redirect" && typeof window !== "undefined") {
              window.location.assign(result.checkoutUrl);
              return { status: "abandoned" };
            }
            return { status: "failed" };
          } catch (error) {
            console.error("Error beginning web checkout:", error);
            return { status: "failed" };
          }
        }
      }
      return session.purchase(input, options);
    }) as UsePurchaseResult<TVariables>["purchase"],
    [session, mode],
  );

  const products = snapshot.products;
  const prefetch = React.useCallback(
    (input?: ProductReference | SuperwallProduct<TVariables>) => {
      if (mode !== "sheet" && mode !== "applePay") return;
      const reference =
        input === undefined
          ? products[0]?.reference
          : typeof input === "string"
            ? input
            : input.reference;
      if (!reference) return;
      const controller = controllerFor(session);
      if (!controller.isStripeProduct(reference)) return;
      void prefetchSession(controller, reference, mode);
    },
    [session, mode, products],
  );

  return React.useMemo(
    () => ({
      purchase,
      prefetch,
      isPurchasing: snapshot.pendingPurchase !== undefined,
      pendingProduct: snapshot.pendingPurchase?.product,
      transaction: snapshot.lastTransaction,
      failure: snapshot.lastPurchaseFailure,
    }),
    [
      purchase,
      prefetch,
      snapshot.pendingPurchase,
      snapshot.lastTransaction,
      snapshot.lastPurchaseFailure,
    ],
  );
};
