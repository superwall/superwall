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
  purchaseWithApplePay,
} from "../checkout/services/registry";

export type UsePurchaseResult<TVariables extends SuperwallProductVariables> = {
  purchase: (
    input: ProductReference | SuperwallProduct<TVariables>,
    options?: Parameters<SuperwallSession<SuperwallProduct<TVariables>>["purchase"]>[1],
  ) => ReturnType<SuperwallSession<SuperwallProduct<TVariables>>["purchase"]>;
  isPurchasing: boolean;
  pendingProduct?: SuperwallProduct<TVariables>;
  transaction?: SuperwallTransaction<SuperwallProduct<TVariables>>;
  failure?: SuperwallPurchaseFailure<SuperwallProduct<TVariables>>;
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
 *
 * With `checkout: "applePay"`, a Stripe product opens the native Apple Pay
 * sheet where the device offers it and falls back to Stripe's embedded
 * sheet everywhere else; `checkout: "sheet"` always opens the embedded
 * sheet. Store products go to the native SDK either way.
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
            if (mode === "applePay") {
              const outcome = await purchaseWithApplePay(session, reference);
              if (outcome.status !== "unavailable") return outcome;
            }

            const warmed =
              mode === "applePay" ? controller.getCachedSession(reference, "apple-pay") : null;
            const result =
              warmed?.directive === "embedded"
                ? warmed
                : await controller.beginCheckout({
                    referenceName: reference,
                    mode: "sheet",
                    cacheScope: "default",
                  });
            if (result.directive === "embedded") {
              return await openEmbeddedCheckout(result, { session, referenceName: reference });
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
      if (!controllerFor(session).isStripeProduct(reference)) return;
      void prefetchSession(session, reference, mode);
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
