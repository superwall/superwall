import * as React from "react";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";
import type { ProductReference } from "./index";
import { clearDiscount, redeemDiscount, sessionsFor } from "../checkout/flow";
import { discountedProductsFor } from "../checkout/discount/pricing";
import type { AppliedDiscount } from "../checkout/types";

export type { AppliedDiscount };

/**
 * What a promotion code does to one product's price. The coupon itself is
 * Stripe's, on `applied.discount` — `percentOff`, `amountOff`, `duration`,
 * `durationInMonths`, spelled the way Stripe spells them. This is only what
 * had to be computed: the two prices and the difference, per product.
 */
export type DiscountedProduct = {
  /** The product reference this price is for. */
  reference: string;
  /** Whether the code lowers this product's price at all. */
  applies: boolean;
  /** ISO currency of every amount here, as Stripe reports it. */
  currency: string;
  /** The recurring price before the code, in minor units (1999 is $19.99). */
  amount: number;
  /** The recurring price the code buys, in minor units. */
  discountedAmount: number;
  /**
   * What the code takes off this product per period, in minor units. Taken
   * from the two prices rather than the coupon, so it is right for a
   * percentage and for an amount larger than the price it applies to.
   */
  savings: number;
  /** `amount`, formatted for the paywall's locale. */
  price: string;
  /** `discountedAmount`, formatted for the paywall's locale. */
  discountedPrice: string;
  /** `savings`, formatted for the paywall's locale. */
  savingsPrice: string;
};

/** A redeemed code: Stripe's coupon, and what it does to each product. */
export type AppliedDiscountState = {
  /** The code the shopper entered, trimmed. */
  code: string;
  /** Stripe's coupon behind the code, in Stripe's own field names. */
  discount: AppliedDiscount;
  /** The affected products, keyed by reference. */
  products: Readonly<Record<string, DiscountedProduct>>;
};

/** What `redeem()` resolves with: the applied code, or why it was refused. */
export type DiscountRedemption =
  | ({ valid: true } & AppliedDiscountState)
  | { valid: false; reason: string };

export type UseDiscountOptions = {
  /** Called when checkout later refuses an applied code and it is dropped. */
  onDropped?: (code: string) => void;
};

export type UseDiscountResult = {
  /** Validates a code and applies it to every product it covers. Never throws. */
  redeem: (code: string) => Promise<DiscountRedemption>;
  /** Forgets the applied code and returns every product to full price. */
  clear: () => void;
  /** The applied code, or `null` when none is. */
  applied: AppliedDiscountState | null;
  /** Whether a `redeem()` is in flight. */
  isRedeeming: boolean;
  /** One product's discounted price, or `undefined` if the code misses it. */
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
 * `applied.discount` is Stripe's coupon as Stripe names it, so a paywall
 * writes its own localized sentence from `percentOff` / `amountOff` /
 * `duration` rather than from a phrase this hook made up.
 */
export const useDiscount = (options: UseDiscountOptions = {}): UseDiscountResult => {
  const session = useSuperwallSession();
  const { products, locale } = useSuperwallSnapshot();
  const sessions = sessionsFor(session);
  const [isRedeeming, setIsRedeeming] = React.useState(false);

  const onDropped = React.useRef(options.onDropped);
  onDropped.current = options.onDropped;
  React.useEffect(
    () => sessions.discounts.subscribeDropped((code) => onDropped.current?.(code)),
    [sessions],
  );

  const raw = React.useSyncExternalStore(
    React.useCallback((listener) => sessions.discounts.subscribe(listener), [sessions]),
    () => sessions.discounts.applied,
    () => null,
  );

  const applied = React.useMemo<AppliedDiscountState | null>(
    () =>
      raw && {
        code: raw.code,
        discount: raw.discount,
        products: discountedProductsFor(products, raw.products, locale),
      },
    [raw, products, locale],
  );

  const redeem = React.useCallback(
    async (code: string): Promise<DiscountRedemption> => {
      setIsRedeeming(true);
      const result = await redeemDiscount(session, code);
      setIsRedeeming(false);

      if (!result.valid) return result;
      return {
        valid: true,
        code: code.trim(),
        discount: result.discount,
        products: discountedProductsFor(products, result.products, locale),
      };
    },
    [session, products, locale],
  );

  const clear = React.useCallback(() => clearDiscount(session), [session]);

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
