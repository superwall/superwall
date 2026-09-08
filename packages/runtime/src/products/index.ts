export type SuperwallKnownProductVariables = {
  identifier?: string;
  price?: string;
  rawPrice?: string | number;
  period?: string;
  periodAlt?: string;
  localizedPeriod?: string;
  periodly?: string;
  periodDays?: string | number;
  periodWeeks?: string | number;
  periodMonths?: string | number;
  periodYears?: string | number;
  dailyPrice?: string;
  weeklyPrice?: string;
  monthlyPrice?: string;
  yearlyPrice?: string;
  trialPeriodPrice?: string;
  rawTrialPeriodPrice?: string | number;
  trialPeriodDailyPrice?: string;
  trialPeriodWeeklyPrice?: string;
  trialPeriodMonthlyPrice?: string;
  trialPeriodYearlyPrice?: string;
  trialPeriodDays?: string | number;
  trialPeriodWeeks?: string | number;
  trialPeriodMonths?: string | number;
  trialPeriodYears?: string | number;
  trialPeriodText?: string;
  trialPeriodEndDate?: string;
  currencyCode?: string;
  currencySymbol?: string;
  locale?: string;
  languageCode?: string;
  isSubscribed?: boolean;
};

export type SuperwallProductVariables = SuperwallKnownProductVariables;

export type SuperwallProductSource = "sdk" | "inline" | "unknown";

export type SuperwallProduct<
  TVariables extends SuperwallProductVariables = SuperwallProductVariables,
> = {
  reference: string;
  productId?: string;
  variables: TVariables;
  source: SuperwallProductSource;
};

export type SuperwallProductInput =
  | string
  | {
      reference: string;
      productId?: string;
      variables?: SuperwallProductVariables;
      source?: SuperwallProductSource;
    };

export const createSuperwallProduct = (input: SuperwallProductInput): SuperwallProduct => {
  if (typeof input === "string") return { reference: input, variables: {}, source: "unknown" };
  return {
    reference: input.reference,
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    variables: input.variables ?? {},
    source: input.source ?? "unknown",
  };
};

export const productReferenceFromInput = (input: SuperwallProductInput): string =>
  typeof input === "string" ? input : input.reference;

export const productsByReference = <TProduct extends SuperwallProduct>(
  products: readonly TProduct[],
): Readonly<Record<string, TProduct>> =>
  Object.fromEntries(products.map((product) => [product.reference, product]));

export const findProductByStoreId = <TProduct extends SuperwallProduct>(
  products: readonly TProduct[],
  productId: string | undefined,
): TProduct | undefined =>
  productId === undefined ? undefined : products.find((product) => product.productId === productId);

export {
  mergeIncomingProducts,
  mergeProductVariables,
  productVariablesFromTemplateVariables,
} from "./merge";
export { createProductDeriver, trialPeriodEndDate } from "./derive";
