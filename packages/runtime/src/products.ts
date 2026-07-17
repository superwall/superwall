import type {
  ProductIdentifierAndType,
  TIncomingMessageProducts,
  TIncomingMessageTemplateVariables,
} from "@superwall/protocol";

/**
 * Product variables the SDK templates provide for every store product.
 * All optional — availability depends on platform and product type.
 */
export type SuperwallKnownProductVariables = {
  identifier?: string;
  price?: string;
  rawPrice?: number;
  period?: string;
  periodly?: string;
  periodDays?: number;
  periodWeeks?: number;
  periodMonths?: number;
  periodYears?: number;
  dailyPrice?: string;
  weeklyPrice?: string;
  monthlyPrice?: string;
  yearlyPrice?: string;
  trialPeriodDays?: number;
  trialPeriodText?: string;
  trialPeriodEndDate?: string;
  currencyCode?: string;
  currencySymbol?: string;
  locale?: string;
  languageCode?: string;
};

export type SuperwallProductVariables = SuperwallKnownProductVariables & Record<string, unknown>;

export type SuperwallProductSource = "sdk" | "inline" | "placeholder" | "unknown";

export type SuperwallProduct<
  TVariables extends SuperwallProductVariables = SuperwallProductVariables,
> = {
  reference: string;
  product: string;
  id?: string;
  productId?: string;
  productIdentifier?: string;
  variables: TVariables;
  source: SuperwallProductSource;
};

export type SuperwallProductInput<TProduct extends SuperwallProduct = SuperwallProduct> =
  | string
  | TProduct
  | {
      reference: string;
      product?: string;
      id?: string;
      productId?: string;
      productIdentifier?: string;
      variables?: SuperwallProductVariables;
      source?: SuperwallProductSource;
    };

const legacyProductReferences = ["primary", "secondary", "tertiary"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const createSuperwallProduct = (
  input: SuperwallProductInput,
  variables: SuperwallProductVariables = {},
): SuperwallProduct => {
  if (typeof input === "string") {
    return {
      reference: input,
      product: input,
      variables,
      source: "unknown",
    };
  }

  const reference = input.reference ?? input.product;
  const productId = input.productId ?? input.productIdentifier ?? input.id;

  return {
    reference,
    product: input.product ?? reference,
    id: input.id ?? productId,
    productId,
    productIdentifier: input.productIdentifier ?? productId,
    variables: input.variables ?? variables,
    source: input.source ?? "unknown",
  };
};

export const productReferenceFromInput = (input: SuperwallProductInput) =>
  typeof input === "string" ? input : input.reference;

export const productsByReference = <TProduct extends SuperwallProduct>(
  products: readonly TProduct[],
): Readonly<Record<string, TProduct>> => {
  const indexed: Record<string, TProduct> = {};

  for (const product of products) {
    indexed[product.reference] = product;
  }

  return indexed;
};

/**
 * SDK-delivered variable records are trusted, not validated: the known
 * variable shapes (`price: string`, `trialPeriodDays: number`, …) are the
 * SDK's side of the protocol contract, and unknown keys pass through for
 * custom template variables.
 */
const asProductVariables = (record: Record<string, unknown>): SuperwallProductVariables =>
  record as SuperwallProductVariables;

export const productVariablesFromTemplateVariables = (
  variables: TIncomingMessageTemplateVariables["variables"],
): Map<string, SuperwallProductVariables> => {
  const result = new Map<string, SuperwallProductVariables>();

  if (Array.isArray(variables.products)) {
    for (const productEntry of variables.products) {
      if (!isRecord(productEntry)) continue;

      for (const [reference, productVariables] of Object.entries(productEntry)) {
        if (isRecord(productVariables)) {
          result.set(reference, asProductVariables(productVariables));
        }
      }
    }
  }

  for (const reference of legacyProductReferences) {
    const productVariables = variables[reference];
    if (isRecord(productVariables) && !result.has(reference)) {
      result.set(reference, asProductVariables(productVariables));
    }
  }

  return result;
};

export const productsFromIncomingMessage = (
  message: TIncomingMessageProducts,
): SuperwallProduct[] =>
  message.products.map((product) =>
    createSuperwallProduct({
      reference: product.product,
      product: product.product,
      productId: product.productId,
      productIdentifier: product.productId,
      source: "sdk",
    }),
  );

export const mergeIncomingProducts = (
  current: readonly SuperwallProduct[],
  incoming: readonly ProductIdentifierAndType[],
): SuperwallProduct[] => {
  const next = new Map<string, SuperwallProduct>();

  for (const product of current) {
    next.set(product.reference, product);
  }

  for (const product of incoming) {
    const existing = next.get(product.product);
    next.set(product.product, {
      ...createSuperwallProduct({
        reference: product.product,
        product: product.product,
        productId: product.productId,
        productIdentifier: product.productId,
        source: "sdk",
      }),
      variables: existing?.variables ?? {},
    });
  }

  return Array.from(next.values());
};

export const mergeProductVariables = (
  current: readonly SuperwallProduct[],
  variables: Map<string, SuperwallProductVariables>,
): SuperwallProduct[] => {
  const next = new Map<string, SuperwallProduct>();

  for (const product of current) {
    next.set(product.reference, product);
  }

  for (const [reference, productVariables] of variables) {
    const existing = next.get(reference);
    next.set(reference, {
      ...createSuperwallProduct(
        existing ?? {
          reference,
          product: reference,
          source: "sdk",
        },
        productVariables,
      ),
      variables: productVariables,
      source: existing?.source ?? "sdk",
    });
  }

  return Array.from(next.values());
};
