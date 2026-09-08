import type {
  ProductIdentifierAndType,
  TIncomingMessageTemplateVariables,
} from "@superwall/protocol";
import {
  createSuperwallProduct,
  type SuperwallProduct,
  type SuperwallProductVariables,
} from "./index";

const LEGACY_REFERENCES = ["primary", "secondary", "tertiary"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * SDK-delivered variable records are trusted, not validated: the declared
 * shapes are the SDK's side of the protocol contract. Numeric-looking fields
 * arrive as strings ("59.99", "7"), which is why they are typed
 * `string | number` — coerce with `Number()` before doing arithmetic.
 */
const asProductVariables = (record: Record<string, unknown>): SuperwallProductVariables =>
  record as SuperwallProductVariables;

export const productVariablesFromTemplateVariables = (
  variables: TIncomingMessageTemplateVariables["variables"],
): Map<string, SuperwallProductVariables> => {
  const result = new Map<string, SuperwallProductVariables>();

  if (Array.isArray(variables.products)) {
    for (const entry of variables.products) {
      if (!isRecord(entry)) continue;
      for (const [reference, productVariables] of Object.entries(entry)) {
        if (isRecord(productVariables)) result.set(reference, asProductVariables(productVariables));
      }
    }
  }

  for (const reference of LEGACY_REFERENCES) {
    const productVariables = variables[reference];
    if (isRecord(productVariables) && !result.has(reference)) {
      result.set(reference, asProductVariables(productVariables));
    }
  }

  return result;
};

const indexed = (products: readonly SuperwallProduct[]): Map<string, SuperwallProduct> =>
  new Map(products.map((product) => [product.reference, product]));

export const mergeIncomingProducts = (
  current: readonly SuperwallProduct[],
  incoming: readonly ProductIdentifierAndType[],
): SuperwallProduct[] => {
  const next = indexed(current);
  for (const { product: reference, productId } of incoming) {
    next.set(reference, {
      reference,
      productId,
      variables: next.get(reference)?.variables ?? {},
      source: "sdk",
    });
  }
  return Array.from(next.values());
};

export const mergeProductVariables = (
  current: readonly SuperwallProduct[],
  variables: ReadonlyMap<string, SuperwallProductVariables>,
): SuperwallProduct[] => {
  const next = indexed(current);
  for (const [reference, productVariables] of variables) {
    const existing = next.get(reference) ?? createSuperwallProduct({ reference, source: "sdk" });
    next.set(reference, { ...existing, variables: productVariables });
  }
  return Array.from(next.values());
};
