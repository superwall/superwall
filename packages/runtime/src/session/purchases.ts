import type { SuperwallProduct } from "../products";
import type { SuperwallPurchaseFailure, SuperwallPurchaseResult } from "./types";

export type PendingPurchase = {
  product: SuperwallProduct;
  resolve: (result: SuperwallPurchaseResult) => void;
};

export type TransactionReference = {
  product?: string;
  product_identifier?: string;
};

export type PurchaseTracker = {
  begin: (product: SuperwallProduct) => Promise<SuperwallPurchaseResult>;
  fail: (
    reference: string,
    reason: SuperwallPurchaseFailure["reason"],
  ) => SuperwallPurchaseFailure | undefined;
  failAll: (reason: SuperwallPurchaseFailure["reason"]) => void;
  find: (message: TransactionReference) => PendingPurchase | undefined;
  take: (message: TransactionReference) => PendingPurchase | undefined;
};

export const createPurchaseTracker = (): PurchaseTracker => {
  const pending = new Map<string, PendingPurchase>();

  const fail: PurchaseTracker["fail"] = (reference, reason) => {
    const entry = pending.get(reference);
    if (!entry) return undefined;
    pending.delete(reference);
    const failure: SuperwallPurchaseFailure = { status: "failed", product: entry.product, reason };
    entry.resolve(failure);
    return failure;
  };

  const find: PurchaseTracker["find"] = (message) => {
    if (message.product !== undefined) return pending.get(message.product);
    if (message.product_identifier !== undefined) {
      for (const entry of pending.values()) {
        if (entry.product.productId === message.product_identifier) return entry;
      }
      return undefined;
    }
    return pending.size === 1 ? pending.values().next().value : undefined;
  };

  return {
    begin: (product) => {
      fail(product.reference, "superseded");
      return new Promise((resolve) => {
        pending.set(product.reference, { product, resolve });
      });
    },
    fail,
    failAll: (reason) => {
      for (const reference of Array.from(pending.keys())) fail(reference, reason);
    },
    find,
    take: (message) => {
      const entry = find(message);
      if (entry) pending.delete(entry.product.reference);
      return entry;
    },
  };
};
