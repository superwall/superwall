import { getLocalizedPeriod } from "../localization/periods";
import type { SuperwallProduct } from "./index";

export const trialPeriodEndDate = (
  trialPeriodDays: unknown,
  language: string | undefined,
): string | undefined => {
  const days = typeof trialPeriodDays === "number" ? trialPeriodDays : Number(trialPeriodDays);
  if (!Number.isFinite(days) || days <= 0) return undefined;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + Math.trunc(days));

  let month: string;
  try {
    month = endDate.toLocaleString(language?.replace(/_/g, "-") ?? "default", { month: "short" });
  } catch {
    month = endDate.toLocaleString("default", { month: "short" });
  }
  return `${month} ${endDate.getDate()}, ${endDate.getFullYear()}`;
};

const localizeProduct = (
  product: SuperwallProduct,
  languages: readonly string[],
): SuperwallProduct => {
  const { period, periodly, trialPeriodDays, trialPeriodEndDate: endDate } = product.variables;
  const derivedEndDate =
    endDate === undefined ? trialPeriodEndDate(trialPeriodDays, languages[0]) : undefined;

  if (typeof period !== "string" && typeof periodly !== "string" && derivedEndDate === undefined) {
    return product;
  }

  return {
    ...product,
    variables: {
      ...product.variables,
      ...(typeof period === "string" ? { period: getLocalizedPeriod(period, [...languages]) } : {}),
      ...(typeof periodly === "string"
        ? { periodly: getLocalizedPeriod(periodly, [...languages]) }
        : {}),
      ...(derivedEndDate === undefined ? {} : { trialPeriodEndDate: derivedEndDate }),
    },
  };
};

export type ProductDeriver = (
  raw: readonly SuperwallProduct[],
  languages: readonly string[],
) => readonly SuperwallProduct[];

export const createProductDeriver = (): ProductDeriver => {
  let last:
    | { raw: readonly SuperwallProduct[]; key: string; products: readonly SuperwallProduct[] }
    | undefined;

  return (raw, languages) => {
    const key = languages.join(",");
    if (last && last.raw === raw && last.key === key) return last.products;
    const products = raw.map((product) => localizeProduct(product, languages));
    last = { raw, key, products };
    return products;
  };
};
