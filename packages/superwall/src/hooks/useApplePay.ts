import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import type { ApplePay, ApplePayAvailability } from "../checkout/applePay";
import { applePayFor } from "../checkout/flow";
import { hostOf, type SuperwallHost } from "../host";
import { useSuperwallSession } from "../provider/context";
import type { ProductReference } from "./index";

/**
 * Whether the shopper's browser can pay with Apple Pay. Only web hosts (the
 * Web SDK, a hosted web paywall, a teleport page and a plain browser page)
 * answer; `useApplePay()` is `undefined` inside the iOS and Android SDKs and in
 * Studio, where a Stripe purchase never opens Apple Pay.
 */
export type UseApplePayResult = {
  /**
   * Whether this browser and device can pay with Apple Pay, from
   * `ApplePaySession.canMakePayments()`. It is known on the first render and
   * needs no checkout session. It cannot see Stripe's side, such as the domain
   * being registered for Apple Pay; a `purchase()` with `checkout: "applePay"`
   * still falls back to the sheet when Stripe refuses the wallet.
   */
  available: boolean;
};

/**
 * Whether the wallet is ready to open for one product. The paywall prepares
 * the wallet for a product only when its checkout mode is `"applePay"`.
 */
export type ApplePayProductStatus =
  | {
      /** The checkout session for the product is being fetched and checked. */
      status: "preparing";
    }
  | {
      /** A `purchase()` of the product with `checkout: "applePay"` opens the wallet at once. */
      status: "ready";
    }
  | {
      /** A `purchase()` of the product with `checkout: "applePay"` falls back to the sheet. */
      status: "unavailable";
      /**
       * Why. `"not_prepared"` means nothing was prepared for the product, as in
       * any checkout mode other than `"applePay"`, not that the device cannot
       * pay. `"apple_pay_not_available"` means Stripe found no Apple Pay on the
       * device. Other values name the step that failed.
       */
      reason: string;
    };

/** The result of `useApplePay(product)`: the device's answer, and the product's. */
export type UseApplePayProductResult = UseApplePayResult & ApplePayProductStatus;

const WEB_HOSTS: ReadonlySet<SuperwallHost> = new Set([
  "web-sdk",
  "web-paywall",
  "web-teleport",
  "browser",
]);

type ApplePaySessionGlobal = { canMakePayments?: () => unknown };

const canMakePayments = (): boolean => {
  try {
    const global = (window as typeof window & { ApplePaySession?: ApplePaySessionGlobal })
      .ApplePaySession;
    return global?.canMakePayments?.() === true;
  } catch {
    return false;
  }
};

const subscribeToNothing = () => () => {};

const sameStatus = (a: ApplePayProductStatus, b: ApplePayAvailability): boolean =>
  a.status === b.status &&
  (a.status !== "unavailable" || (b.status === "unavailable" && a.reason === b.reason));

const productStatusReader = (applePay: ApplePay | undefined, reference: string | undefined) => {
  let last: ApplePayProductStatus | undefined;
  return (): ApplePayProductStatus | undefined => {
    if (!applePay || reference === undefined) return undefined;
    const next = applePay.availability(reference);
    if (!last || !sameStatus(last, next)) last = next;
    return last;
  };
};

/**
 * Whether Apple Pay is available on a web host, to show an Apple Pay button
 * only where it opens the wallet. With a product it also says whether the
 * wallet is ready for that product, and re-renders as the checkout prepares
 * it. `undefined` inside the iOS and Android SDKs and in Studio.
 *
 * ```tsx
 * const applePay = useApplePay();
 * return applePay?.available ? (
 *   <button onClick={() => purchase(reference, { checkout: "applePay" })}>Apple Pay</button>
 * ) : (
 *   <button onClick={() => purchase(reference, { checkout: "sheet" })}>Pay with card</button>
 * );
 * ```
 */
export function useApplePay(): UseApplePayResult | undefined;
export function useApplePay(
  product: ProductReference | SuperwallProduct,
): UseApplePayProductResult | undefined;
export function useApplePay(
  product?: ProductReference | SuperwallProduct,
): UseApplePayResult | UseApplePayProductResult | undefined {
  const session = useSuperwallSession();
  const web = React.useMemo(() => WEB_HOSTS.has(hostOf()), []);
  const available = React.useMemo(() => web && canMakePayments(), [web]);
  const reference =
    product === undefined || typeof product === "string" ? product : product.reference;
  const applePay = web && reference !== undefined ? applePayFor(session) : undefined;
  const read = React.useMemo(() => productStatusReader(applePay, reference), [applePay, reference]);
  const productStatus = React.useSyncExternalStore(
    applePay ? applePay.subscribe : subscribeToNothing,
    read,
    read,
  );
  return React.useMemo(() => {
    if (!web) return undefined;
    return productStatus ? { available, ...productStatus } : { available };
  }, [web, available, productStatus]);
}
