import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import type { ApplePay, ApplePayAvailability, ApplePayWalletReason } from "../checkout/applePay";
import { applePayFor } from "../checkout/flow";
import { hostOf, type SuperwallHost } from "../host";
import { useSuperwallSession } from "../provider/context";
import type { ProductReference } from "./index";

/**
 * Why the browser cannot open the Apple Pay wallet itself.
 *
 * - `"unsupported_browser"`: the browser has no Apple Pay JS
 *   (`ApplePaySession`), as in Chrome, Firefox or Edge on a desktop. The card
 *   sheet may still offer Apple Pay there through a QR code scanned with an
 *   iPhone, which is not direct Apple Pay.
 * - `"insecure_context"`: the page is not served over HTTPS, and Safari
 *   offers Apple Pay only on secure pages.
 * - `"device_unsupported"`: the browser has Apple Pay JS but says this device
 *   cannot pay with it, such as a Mac without Touch ID and no iPhone or Apple
 *   Watch nearby to confirm.
 * - `"cross_origin_frame"`: the paywall runs in a frame of another origin and
 *   the browser refused the check there.
 * - `"check_failed"`: the browser threw on the check for another reason; the
 *   paywall logs its error.
 */
export type ApplePayUnavailableReason =
  | "unsupported_browser"
  | "insecure_context"
  | "device_unsupported"
  | "cross_origin_frame"
  | "check_failed";

/**
 * Whether this browser can open the Apple Pay wallet itself (direct Apple
 * Pay), from `ApplePaySession.canMakePayments()`. Only web hosts (the Web
 * SDK, a hosted web paywall, a teleport page and a plain browser page)
 * answer; `useApplePay()` is `undefined` inside the iOS and Android SDKs and
 * in Studio, where a Stripe purchase never opens Apple Pay.
 *
 * It is known on the first render and needs no checkout session, but it
 * cannot see whether a card is in Wallet or whether the domain is registered
 * for Apple Pay with Stripe: only Stripe can, once it prepares a product, and
 * `useApplePay(product)` reports that as the product's `status`.
 */
export type UseApplePayResult =
  | {
      /** The browser can open the Apple Pay wallet. */
      available: true;
    }
  | {
      /** The browser cannot open the Apple Pay wallet. */
      available: false;
      /** Why not. See `ApplePayUnavailableReason`. */
      reason: ApplePayUnavailableReason;
    };

/**
 * Whether the wallet is ready to open for one product. The wallet opens only
 * for a product prepared before the tap: the paywall prepares it on its own
 * when the config's `checkout` is `"applePay"`, and
 * `prefetch(product, { checkout: "applePay" })` prepares it when the config's
 * `checkout` is `"sheet"`. A `purchase()` with `checkout: "applePay"` of a
 * product that is not ready opens the sheet instead.
 */
export type ApplePayProductStatus =
  | {
      /** Stripe is loading and checking the wallet for the product. */
      status: "preparing";
    }
  | {
      /** A `purchase()` of the product with `checkout: "applePay"` opens the wallet at once. */
      status: "ready";
    }
  | {
      /** A `purchase()` of the product with `checkout: "applePay"` opens the sheet instead. */
      status: "unavailable";
      /**
       * Why.
       *
       * - `"not_prepared"`: nothing prepared the wallet for the product yet,
       *   neither the config's `checkout: "applePay"` nor a
       *   `prefetch(product, { checkout: "applePay" })`. It says nothing about
       *   the device.
       * - `"apple_pay_not_available"`: Stripe found no way to pay with Apple
       *   Pay here. With `available: true` that means no card is set up in
       *   Wallet, the domain is not registered for Apple Pay with Stripe, or
       *   Safari's "Allow websites to check for Apple Pay" setting is off.
       * - `"missing_public_api_key"`: the host supplied no public API key.
       * - `"no_apple_pay_quote"`: the backend's checkout session for the
       *   product cannot be paid with Apple Pay.
       * - `"prepare_failed"`: fetching the checkout session failed.
       * - `"stripe_js_load_failed"`: Stripe.js did not load.
       * - `"can_make_payment_failed"`: Stripe's own check threw.
       * - `"show_failed"`: the wallet failed to open on the last tap.
       */
      reason: ApplePayWalletReason;
    };

/** The result of `useApplePay(product)`: the browser's answer, and the product's. */
export type UseApplePayProductResult = UseApplePayResult & {
  /** Whether the wallet is ready to open for the product. */
  product: ApplePayProductStatus;
};

const WEB_HOSTS: ReadonlySet<SuperwallHost> = new Set([
  "web-sdk",
  "web-paywall",
  "web-teleport",
  "browser",
]);

type ApplePaySessionGlobal = { canMakePayments?: () => unknown };

const isCrossOriginFrame = (): boolean => {
  if (window.top === window.self) return false;
  try {
    return window.top?.location.origin !== window.location.origin;
  } catch {
    return true;
  }
};

const checkApplePay = (): UseApplePayResult => {
  if (window.isSecureContext === false) return { available: false, reason: "insecure_context" };
  const global = (window as typeof window & { ApplePaySession?: ApplePaySessionGlobal })
    .ApplePaySession;
  if (typeof global?.canMakePayments !== "function") {
    return { available: false, reason: "unsupported_browser" };
  }
  try {
    return global.canMakePayments() === true
      ? { available: true }
      : { available: false, reason: "device_unsupported" };
  } catch (error) {
    if (isCrossOriginFrame()) return { available: false, reason: "cross_origin_frame" };
    console.warn("ApplePaySession.canMakePayments() threw:", error);
    return { available: false, reason: "check_failed" };
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
 * Whether direct Apple Pay, the wallet the browser opens itself, is available
 * on a web host, and why not when it is not. With a product it also says
 * whether the wallet is ready for that product, which is the only answer that
 * knows about the cards in Wallet and the domain's Stripe registration, and
 * re-renders as the checkout prepares it. `undefined` inside the iOS and
 * Android SDKs and in Studio.
 *
 * On a paywall whose config `checkout` is `"sheet"`, prefetch the product for
 * Apple Pay before the tap; with `checkout: "applePay"` the paywall does it on
 * its own. With any other config `checkout` a Stripe purchase opens the hosted
 * checkout whatever the call asks for.
 *
 * ```tsx
 * const { purchase, prefetch } = usePurchase();
 * const applePay = useApplePay(reference);
 * useEffect(() => {
 *   if (applePay?.available) prefetch(reference, { checkout: "applePay" });
 * }, [applePay?.available, reference]);
 * return applePay?.available && applePay.product.status === "ready" ? (
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
  const device = React.useMemo(() => (web ? checkApplePay() : undefined), [web]);
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
    if (!device) return undefined;
    return productStatus ? { ...device, product: productStatus } : device;
  }, [device, productStatus]);
}
