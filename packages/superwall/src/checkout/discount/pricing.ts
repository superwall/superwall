import type { SuperwallProduct } from "@superwall/runtime";
import { formatMinorUnits } from "./money";
import { bareProductIdentifier } from "../products";
import type { DiscountedProductPrice } from "../types";
import type { DiscountedProduct } from "../../hooks/useDiscount";

const toDiscountedProduct = (
  reference: string,
  price: DiscountedProductPrice,
  locale: string,
): DiscountedProduct => {
  const savings = Math.max(0, price.originalAmount - price.discountedAmount);
  return {
    reference,
    applies: price.applies,
    currency: price.currency,
    amount: price.originalAmount,
    discountedAmount: price.discountedAmount,
    savings,
    price: formatMinorUnits(price.originalAmount, price.currency, locale),
    discountedPrice: formatMinorUnits(price.discountedAmount, price.currency, locale),
    savingsPrice: formatMinorUnits(savings, price.currency, locale),
  };
};

export const discountedProductsFor = (
  products: readonly SuperwallProduct[],
  prices: readonly DiscountedProductPrice[],
  locale: string,
): Record<string, DiscountedProduct> => {
  const byIdentifier = new Map(
    prices.map((price) => [bareProductIdentifier(price.productIdentifier), price]),
  );
  const entries: Record<string, DiscountedProduct> = {};
  for (const product of products) {
    const price =
      product.productId === undefined
        ? undefined
        : byIdentifier.get(bareProductIdentifier(product.productId));
    if (price) {
      entries[product.reference] = toDiscountedProduct(product.reference, price, locale);
    }
  }
  return entries;
};
