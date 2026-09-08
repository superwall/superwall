import * as React from "react";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";
import type { ProductReference } from "./index";
import { controllerFor, invalidateSessions, reprefetch } from "../checkout/services/registry";
import { bareProductIdentifier } from "../checkout/services/WebCheckoutController";
import { formatMinorUnits } from "../checkout/utils/currency";
import type { AppliedDiscount, DiscountedProductPrice } from "../checkout/state/types";

/**
 * What a code takes off a product, in parts a paywall can assemble into its
 * own sentence — "15% off forever", "$5 off for 3 months", "Save $5".
 *
 * Deliberately not a phrase: paywalls are localized, and a sentence built
 * here would ship English into every locale.
 */
export type DiscountSummary = {
  /** Whether the coupon takes off a percentage or a fixed amount. */
  kind: "percent" | "amount";
  /** The percentage taken off, when `kind` is "percent". */
  percentOff?: number;
  /** The amount taken off in minor units, when `kind` is "amount". */
  amountOff?: number;
  /** `amountOff`, formatted for the paywall's locale. */
  amountOffPrice?: string;
  /**
   * What this product saves per period, in minor units. Taken from the priced
   * amounts rather than the coupon, so it is right for a percentage and for an
   * amount coupon larger than the price it applies to.
   */
  savings: number;
  /** `savings`, formatted for the paywall's locale. */
  savingsPrice: string;
  /** Whether the discount applies once, for a number of months, or forever. */
  duration: "once" | "repeating" | "forever";
  /** How many months a "repeating" discount lasts. */
  durationInMonths?: number;
};

export type DiscountedProduct = {
  reference: string;
  /** Whether the code lowers this product's price at all. */
  applies: boolean;
  currency: string;
  /** Recurring price before and after the code, in minor units. */
  originalAmount: number;
  discountedAmount: number;
  /** The same two prices, formatted for the paywall's locale. */
  originalPrice: string;
  discountedPrice: string;
  /** The discount in composable parts, for rendering what it gives. */
  summary: DiscountSummary;
};

export type AppliedDiscountState = {
  code: string;
  discount: AppliedDiscount;
  products: Readonly<Record<string, DiscountedProduct>>;
};

export type DiscountRedemption =
  | ({ valid: true } & AppliedDiscountState)
  | {
      valid: false;
      reason: string;
    };

export type UseDiscountOptions = {
  onDropped?: (code: string) => void;
};

export type UseDiscountResult = {
  redeem: (code: string) => Promise<DiscountRedemption>;
  clear: () => void;
  applied: AppliedDiscountState | null;
  isRedeeming: boolean;
  getDiscountedProduct: (reference: ProductReference) => DiscountedProduct | undefined;
};

/**
 * Stripe promotion codes for web checkout. Redeemed codes ride on every
 * checkout session for the products they apply to — the Apple Pay sheet and
 * Stripe's embedded sheet both quote and charge the discounted price — and
 * the hook exposes the discounted prices so the paywall can show them.
 *
 * ```tsx
 * const { redeem, applied, getDiscountedProduct } = useDiscount({
 *   onDropped: () => toast("That code is no longer valid"),
 * })
 * const discounted = getDiscountedProduct("primary")
 * const price = discounted?.discountedPrice ?? product.variables.price
 * ```
 *
 * Each product's `summary` carries the discount in parts — percent or amount,
 * what it saves, how long it lasts — so a paywall can say what the code gives
 * in its own localized words.
 */
export const useDiscount = (options: UseDiscountOptions = {}): UseDiscountResult => {
  const session = useSuperwallSession();
  const snapshot = useSuperwallSnapshot();
  const controller = controllerFor(session);
  const [isRedeeming, setIsRedeeming] = React.useState(false);

  const onDroppedRef = React.useRef(options.onDropped);
  onDroppedRef.current = options.onDropped;
  React.useEffect(
    () => controller.subscribeDiscountDropped((code) => onDroppedRef.current?.(code)),
    [controller],
  );

  const raw = React.useSyncExternalStore(
    React.useCallback((listener) => controller.subscribeDiscount(listener), [controller]),
    () => controller.getAppliedDiscount(),
    () => null,
  );

  const products = snapshot.products;
  const locale = snapshot.locale;
  const applied = React.useMemo<AppliedDiscountState | null>(() => {
    if (!raw) return null;
    const byIdentifier = new Map(
      raw.products.map((price) => [bareProductIdentifier(price.productIdentifier), price]),
    );
    const entries: Record<string, DiscountedProduct> = {};
    for (const product of products) {
      const identifier = product.productId;
      const price = identifier ? byIdentifier.get(bareProductIdentifier(identifier)) : undefined;
      if (!price) continue;
      entries[product.reference] = toDiscountedProduct(
        product.reference,
        price,
        raw.discount,
        locale,
      );
    }
    return { code: raw.code, discount: raw.discount, products: entries };
  }, [raw, products, locale]);

  const redeem = React.useCallback(
    async (code: string): Promise<DiscountRedemption> => {
      setIsRedeeming(true);
      try {
        const result = await controller.redeemDiscount(code);
        if (!result.valid) return result;
        invalidateSessions(session, "discount code redeemed");
        reprefetch(session);
        const state = controller.getAppliedDiscount();
        return {
          valid: true,
          code: state?.code ?? code.trim(),
          discount: result.discount,
          products: Object.fromEntries(
            result.products.flatMap((price) => {
              const reference = products.find((product) => {
                const identifier = product.productId;
                return (
                  identifier !== undefined &&
                  bareProductIdentifier(identifier) ===
                    bareProductIdentifier(price.productIdentifier)
                );
              })?.reference;
              return reference
                ? [[reference, toDiscountedProduct(reference, price, result.discount, locale)]]
                : [];
            }),
          ),
        };
      } catch {
        return { valid: false, reason: "request_failed" };
      } finally {
        setIsRedeeming(false);
      }
    },
    [controller, session, products, locale],
  );

  const clear = React.useCallback(() => {
    if (!controller.getAppliedDiscount()) return;
    controller.clearDiscount();
    invalidateSessions(session, "discount code cleared");
    reprefetch(session);
  }, [controller, session]);

  return React.useMemo(
    () => ({
      redeem,
      clear,
      applied,
      isRedeeming,
      getDiscountedProduct: (reference: ProductReference) => applied?.products[reference],
    }),
    [redeem, clear, applied, isRedeeming],
  );
};

const toDiscountedProduct = (
  reference: string,
  price: DiscountedProductPrice,
  discount: AppliedDiscount,
  locale: string,
): DiscountedProduct => {
  const savings = Math.max(0, price.originalAmount - price.discountedAmount);
  return {
    reference,
    applies: price.applies,
    currency: price.currency,
    originalAmount: price.originalAmount,
    discountedAmount: price.discountedAmount,
    originalPrice: formatMinorUnits(price.originalAmount, price.currency, locale),
    discountedPrice: formatMinorUnits(price.discountedAmount, price.currency, locale),
    summary: {
      kind: discount.percentOff != null ? "percent" : "amount",
      ...(discount.percentOff != null ? { percentOff: discount.percentOff } : {}),
      ...(discount.amountOff != null
        ? {
            amountOff: discount.amountOff,
            amountOffPrice: formatMinorUnits(discount.amountOff, price.currency, locale),
          }
        : {}),
      savings,
      savingsPrice: formatMinorUnits(savings, price.currency, locale),
      duration: discount.duration ?? "forever",
      ...(discount.durationInMonths != null ? { durationInMonths: discount.durationInMonths } : {}),
    },
  };
};
