import type { TIncomingMessageCallbackResult, TPermissionStatus } from "@superwall/protocol";
import { productVariablesFromTemplateVariables, type SuperwallProduct } from "../products";

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
  paywall?: { id: string; identifier: string };
  lastTransaction?: { status: "completed" | "abandoned"; product: TProduct };
  permissionStatuses?: SuperwallPermissionStatuses;
  callbackStates?: SuperwallCallbackStates;
  introductoryOffer?: { eligible?: boolean };
};

export const buildSuperwallState = <TProduct extends SuperwallProduct = SuperwallProduct>({
  variables,
  products,
  paywall,
  lastTransaction,
  permissionStatuses = {},
  callbackStates = {},
  introductoryOffer,
}: BuildSuperwallStateOptions<TProduct>): SuperwallSdkState => {
  const productState: Record<string, unknown> = Object.fromEntries(
    productVariablesFromTemplateVariables(variables),
  );

  if (introductoryOffer?.eligible !== undefined) {
    productState.hasIntroductoryOffer = introductoryOffer.eligible;
  }

  for (const product of products) {
    const existing = productState[product.reference];
    productState[product.reference] = {
      ...(typeof existing === "object" && existing !== null ? existing : {}),
      ...product.variables,
      productId: product.productId,
      source: product.source,
    };
  }

  productState.abandonedProductId =
    lastTransaction?.status === "abandoned" ? lastTransaction.product.reference : "";
  productState.purchasedProductId =
    lastTransaction?.status === "completed" ? lastTransaction.product.reference : "";
  if (lastTransaction) {
    productState[lastTransaction.status === "completed" ? "purchased" : "abandoned"] =
      lastTransaction.product.variables;
  }

  return {
    ...variables,
    state: {
      didAbandonTransaction: lastTransaction?.status === "abandoned",
      didCompleteTransaction: lastTransaction?.status === "completed",
    },
    products: productState,
    permissions: permissionStatuses,
    callbacks: callbackStates,
    ...(paywall ? { paywall } : {}),
  };
};
