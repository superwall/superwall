import * as React from "react";
import type {
  SuperwallProduct,
  SuperwallProductVariables,
  SuperwallPurchaseFailure,
  SuperwallSession,
  SuperwallTransaction,
} from "@superwall/runtime";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UsePurchaseResult<TVariables extends SuperwallProductVariables> = {
  /**
   * Starts a purchase and resolves with the outcome — never throws for flow
   * results: `{ status: "completed" | "abandoned" | "failed" }`.
   */
  purchase: SuperwallSession<SuperwallProduct<TVariables>>["purchase"];
  /** True while a purchase is awaiting a transaction result. */
  isPurchasing: boolean;
  /** The product currently being purchased, if any. */
  pendingProduct?: SuperwallProduct<TVariables>;
  /** The most recent completed or abandoned transaction. */
  transaction?: SuperwallTransaction<SuperwallProduct<TVariables>>;
  /** The most recent purchase failure (timeout/superseded), cleared on the next attempt. */
  failure?: SuperwallPurchaseFailure<SuperwallProduct<TVariables>>;
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

  return React.useMemo(
    () => ({
      purchase: session.purchase.bind(session),
      isPurchasing: snapshot.pendingPurchase !== undefined,
      pendingProduct: snapshot.pendingPurchase?.product,
      transaction: snapshot.lastTransaction,
      failure: snapshot.lastPurchaseFailure,
    }),
    [session, snapshot.pendingPurchase, snapshot.lastTransaction, snapshot.lastPurchaseFailure],
  );
};
