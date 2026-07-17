import * as React from "react";
import type { SuperwallProduct, SuperwallProductVariables } from "@superwall/runtime";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseProductsResult<TVariables extends SuperwallProductVariables> = {
  products: readonly SuperwallProduct<TVariables>[];
  getProduct: (reference: string) => SuperwallProduct<TVariables> | undefined;
};

/**
 * The products this paywall renders, keyed by reference.
 *
 * Product data (price, period, trial…) is SDK-owned store data on
 * `product.variables`; `period`/`periodly` arrive pre-localized.
 *
 * ```tsx
 * const { products } = useProducts()
 * products[0].variables.price // "$39.99"
 * ```
 */
export const useProducts = <
  TVariables extends SuperwallProductVariables = SuperwallProductVariables,
>(): UseProductsResult<TVariables> => {
  const snapshot = useSuperwallSnapshot<SuperwallProduct<TVariables>>();

  return React.useMemo(
    () => ({
      products: snapshot.products,
      getProduct: (reference: string) => snapshot.productsByReference[reference],
    }),
    [snapshot.products, snapshot.productsByReference],
  );
};
