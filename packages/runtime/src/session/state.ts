import type { TIncomingMessageCallbackResult, TPermissionStatus } from "@superwall/protocol";
import type { SuperwallProduct } from "../products";

export type SuperwallSdkState = Readonly<Record<string, unknown>>;

export type SuperwallPermissionStatuses = Readonly<Record<string, TPermissionStatus>>;

export type SuperwallCallbackState = Readonly<{
  result: TIncomingMessageCallbackResult["status"];
  data?: Record<string, unknown>;
}>;

export type SuperwallCallbackStates = Readonly<Record<string, SuperwallCallbackState>>;

export type BuildSuperwallStateOptions<TProduct extends SuperwallProduct = SuperwallProduct> = {
  variables: Readonly<Record<string, unknown>>;
  products: readonly TProduct[];
  paywall?: {
    id: string;
    identifier: string;
  };
  lastTransaction?: {
    status: "completed" | "abandoned";
    product: TProduct;
  };
  permissionStatuses?: SuperwallPermissionStatuses;
  callbackStates?: SuperwallCallbackStates;
  trial?: { eligible?: boolean };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const productStateFromVariables = (variables: Readonly<Record<string, unknown>>) => {
  const products: Record<string, unknown> = {};

  if (Array.isArray(variables.products)) {
    for (const entry of variables.products) {
      if (!isRecord(entry)) continue;

      for (const [reference, productVariables] of Object.entries(entry)) {
        products[reference] = productVariables;
      }
    }
  }

  for (const reference of ["primary", "secondary", "tertiary"]) {
    const productVariables = variables[reference];
    if (isRecord(productVariables) && !products[reference]) {
      products[reference] = productVariables;
    }
  }

  return products;
};

export const buildSuperwallState = <TProduct extends SuperwallProduct = SuperwallProduct>({
  variables,
  products,
  paywall,
  lastTransaction,
  permissionStatuses = {},
  callbackStates = {},
  trial,
}: BuildSuperwallStateOptions<TProduct>): SuperwallSdkState => {
  const productState = productStateFromVariables(variables);

  if (trial?.eligible !== undefined) {
    productState.hasIntroductoryOffer = trial.eligible;
  }

  for (const product of products) {
    const existingProductState = productState[product.reference];
    productState[product.reference] = {
      ...(isRecord(existingProductState) ? existingProductState : {}),
      ...product.variables,
      productId: product.productId,
      productIdentifier: product.productIdentifier,
      source: product.source,
    };
  }

  const transactionState = {
    didAbandonTransaction: lastTransaction?.status === "abandoned",
    didCompleteTransaction: lastTransaction?.status === "completed",
  };

  productState.abandonedProductId =
    lastTransaction?.status === "abandoned" ? lastTransaction.product.reference : "";
  productState.purchasedProductId =
    lastTransaction?.status === "completed" ? lastTransaction.product.reference : "";

  if (lastTransaction) {
    const transactionProduct = lastTransaction.product;
    productState[lastTransaction.status === "completed" ? "purchased" : "abandoned"] =
      transactionProduct.variables;
  }

  const state: Record<string, unknown> = {
    ...variables,
    state: transactionState,
    products: productState,
    permissions: permissionStatuses,
    callbacks: callbackStates,
  };

  if (paywall) {
    state.paywall = paywall;
  }

  return state;
};
