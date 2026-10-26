import * as React from "react";
import type {
  SuperwallProduct,
  SuperwallProductVariables,
  SuperwallPurchaseFailure,
  SuperwallPurchaseOptions,
  SuperwallPurchaseResult,
  SuperwallTransaction,
} from "@superwall/runtime";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";
import type { ProductReference } from "./index";
import { prefetchSession, purchaseOnWeb, sessionsFor } from "../checkout/flow";
import { useAutoPrefetch } from "../checkout/hooks/useAutoPrefetch";
import { useIdentityRefresh } from "../checkout/hooks/useIdentityRefresh";
import { checkoutModeFor } from "../checkout/host/sdk";
import { flowQuery, teleportFor } from "../checkout/teleport/flow";
import { QueryStoreContext } from "../navigation/query";
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
  prefetch: (
    input?: ProductReference | SuperwallProduct<TVariables>,
    options?: Pick<SuperwallPurchaseOptions, "checkout">,
  ) => void;
};

const referenceOf = (input: string | { reference: string }): string =>
  typeof input === "string" ? input : input.reference;

/**
 * Buy a product. Store products go to the native SDK; a Stripe product is
 * always bought on the web. With `checkout: "sheet"` it opens Stripe's
 * embedded sheet; with `"applePay"` it opens the wallet where the device
 * offers it and falls back to the sheet; otherwise, and always inside an iOS
 * app, it opens Superwall's hosted checkout in the browser. A `purchase()` or
 * `prefetch()` call can pass its own `checkout` mode, under the same iOS
 * rule. Web checkout only runs when a host supplied a public API key.
 */
export const usePurchase = <
  TVariables extends SuperwallProductVariables = SuperwallProductVariables,
>(): UsePurchaseResult<TVariables> => {
  const session = useSuperwallSession<SuperwallProduct<TVariables>>();
  const queryStore = React.useContext(QueryStoreContext);
  const snapshot = useSuperwallSnapshot<SuperwallProduct<TVariables>>();

  const mode = checkoutModeFor(snapshot);
  const hasApiKey =
    typeof snapshot.device.publicApiKey === "string" && snapshot.device.publicApiKey !== "";

  const webMode: CheckoutMode | undefined = hasApiKey ? mode : undefined;
  useAutoPrefetch();
  useIdentityRefresh();

  const purchase = React.useCallback(
    async (
      input: ProductReference | SuperwallProduct<TVariables>,
      options?: SuperwallPurchaseOptions,
    ): Promise<PurchaseResult<TVariables>> => {
      const reference = referenceOf(input);
      const product = session.getSnapshot().productsByReference[reference];
      const teleporter = teleportFor(session);
      const { postPurchase, stripeMetadata } = options ?? {};
      if (product && sessionsFor(session).isStripeProduct(reference) && teleporter.available()) {
        const outcome = await teleporter.begin({
          productReference: reference,
          query: flowQuery(queryStore),
          postPurchase,
          stripeMetadata,
        });
        if (typeof outcome === "object") return session.purchase(outcome.fallback, options);
        return { status: outcome, product };
      }
      if (webMode && product && sessionsFor(session).isStripeProduct(reference)) {
        const status = await purchaseOnWeb(session, reference, options?.checkout ?? webMode, {
          postPurchase,
          stripeMetadata,
        });
        return { status, product };
      }
      return session.purchase(input, options);
    },
    [session, webMode, queryStore],
  );

  const first = snapshot.products[0]?.reference;
  const prefetch = React.useCallback(
    (
      input?: ProductReference | SuperwallProduct<TVariables>,
      options?: Pick<SuperwallPurchaseOptions, "checkout">,
    ) => {
      const reference = input === undefined ? first : referenceOf(input);
      if (!webMode || reference === undefined) return;
      if (!sessionsFor(session).isStripeProduct(reference)) return;
      const snapshot = session.getSnapshot();
      void prefetchSession(
        session,
        reference,
        checkoutModeFor(snapshot, options?.checkout ?? webMode),
      );
    },
    [session, webMode, first],
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
