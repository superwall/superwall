import * as React from "react";
import type {
  SuperwallProduct,
  SuperwallProductVariables,
  SuperwallPurchaseFailure,
  SuperwallPurchaseOptions,
  SuperwallPurchaseResult,
  SuperwallTransaction,
} from "@superwall/runtime";
import { checkoutModeOf } from "@superwall/runtime";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";
import type { ProductReference } from "./index";
import { prefetchSession, purchaseOnWeb, sessionsFor } from "../checkout/flow";
import type { CheckoutMode, PurchaseOutcome } from "../checkout/types";

export type WebCheckoutResult<TProduct extends SuperwallProduct = SuperwallProduct> = {
  status: PurchaseOutcome;
  product: TProduct;
};

export type PurchaseResult<TVariables extends SuperwallProductVariables> =
  | SuperwallPurchaseResult<SuperwallProduct<TVariables>>
  | WebCheckoutResult<SuperwallProduct<TVariables>>;

export type UsePurchaseResult<TVariables extends SuperwallProductVariables> = {
  purchase: (
    input: ProductReference | SuperwallProduct<TVariables>,
    options?: SuperwallPurchaseOptions,
  ) => Promise<PurchaseResult<TVariables>>;
  isPurchasing: boolean;
  pendingProduct?: SuperwallProduct<TVariables>;
  transaction?: SuperwallTransaction<SuperwallProduct<TVariables>>;
  failure?: SuperwallPurchaseFailure<SuperwallProduct<TVariables>>;
  prefetch: (input?: ProductReference | SuperwallProduct<TVariables>) => void;
};

const referenceOf = (input: string | { reference: string }): string =>
  typeof input === "string" ? input : input.reference;

/**
 * Buy a product. Store products go to the native SDK. With `checkout: "sheet"`
 * a Stripe product opens Stripe's embedded sheet; with `"applePay"` it opens
 * the wallet where the device offers it and falls back to the sheet. Web
 * checkout only runs when a host supplied a public API key.
 */
export const usePurchase = <
  TVariables extends SuperwallProductVariables = SuperwallProductVariables,
>(): UsePurchaseResult<TVariables> => {
  const session = useSuperwallSession<SuperwallProduct<TVariables>>();
  const snapshot = useSuperwallSnapshot<SuperwallProduct<TVariables>>();

  const mode = checkoutModeOf(snapshot.config?.checkout);
  const hasApiKey =
    typeof snapshot.device.publicApiKey === "string" && snapshot.device.publicApiKey !== "";

  const webMode: CheckoutMode | undefined = hasApiKey ? mode : undefined;
  const warmMode = webMode === "sheet" || webMode === "applePay" ? webMode : undefined;

  const purchase = React.useCallback(
    async (
      input: ProductReference | SuperwallProduct<TVariables>,
      options?: SuperwallPurchaseOptions,
    ): Promise<PurchaseResult<TVariables>> => {
      const reference = referenceOf(input);
      const product = session.getSnapshot().productsByReference[reference];
      if (webMode && product && sessionsFor(session).isStripeProduct(reference)) {
        return { status: await purchaseOnWeb(session, reference, webMode), product };
      }
      return session.purchase(input, options);
    },
    [session, webMode],
  );

  const first = snapshot.products[0]?.reference;
  const prefetch = React.useCallback(
    (input?: ProductReference | SuperwallProduct<TVariables>) => {
      const reference = input === undefined ? first : referenceOf(input);
      if (!warmMode || reference === undefined) return;
      if (!sessionsFor(session).isStripeProduct(reference)) return;
      void prefetchSession(session, reference, warmMode);
    },
    [session, warmMode, first],
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
