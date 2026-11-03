import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import {
  applePayErrorOf,
  type ApplePay,
  type ApplePayAvailability,
  type ApplePayError,
  type ApplePayWalletReason,
} from "../checkout/applePay";
import { applePayFor } from "../checkout/flow";
import { hostOf, WEB_HOSTS } from "../host";
import { useSuperwallSession } from "../provider/context";
import type { ProductReference } from "./index";

export type { ApplePayError, ApplePayWalletReason };

/**
 * Why the browser cannot open the Apple Pay wallet itself.
 *
 * - `"unsupported_browser"`: the browser has no Apple Pay JS
 *   (`ApplePaySession`), as in Chrome, Firefox or Edge on a desktop. The card
 *   sheet may still offer Apple Pay there through a QR code scanned with an
 *   iPhone, which is not direct Apple Pay.
 * - `"insecure_context"`: the page is not served over HTTPS. Safari offers
 *   Apple Pay only on HTTPS pages, `http://localhost` included.
 * - `"device_unsupported"`: the browser has Apple Pay JS but says this device
 *   cannot pay with it, such as a Mac without Touch ID and no iPhone or Apple
 *   Watch nearby to confirm.
 * - `"cross_origin_frame"`: the paywall runs in a frame of another origin and
 *   the browser refused the check there.
 * - `"check_failed"`: the browser threw on the check for another reason;
 *   `error` holds it.
 */
export type ApplePayUnavailableReason =
  | "unsupported_browser"
  | "insecure_context"
  | "device_unsupported"
  | "cross_origin_frame"
  | "check_failed";

/**
 * Why the wallet cannot open for a product: the browser's reason when the
 * browser cannot open it at all, otherwise the product's.
 */
export type ApplePayProductReason = ApplePayUnavailableReason | ApplePayWalletReason;

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
 * `useApplePay(product)` reports that as `product`.
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
      /** The reason in a sentence, in English, for logs and debugging. */
      message: string;
      /** What the browser threw, when the check threw. */
      error?: ApplePayError;
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
      /** Why. See `ApplePayProductReason`. */
      reason: ApplePayProductReason;
      /** The reason in a sentence, in English, for logs and debugging. */
      message: string;
      /** What the browser or Stripe threw, when a step threw. */
      error?: ApplePayError;
    };

/** The result of `useApplePay(product)`: the browser's answer, and the product's. */
export type UseApplePayProductResult = UseApplePayResult & {
  /** Whether the wallet is ready to open for the product. */
  product: ApplePayProductStatus;
};

const MESSAGES: Record<ApplePayProductReason, string> = {
  unsupported_browser: "This browser has no Apple Pay JS, so it cannot open the wallet itself.",
  insecure_context: "Apple Pay needs the page to be served over HTTPS.",
  device_unsupported: "The browser says this device cannot pay with Apple Pay.",
  cross_origin_frame: "The browser refused the Apple Pay check in a frame of another origin.",
  check_failed: "The browser threw on the Apple Pay check.",
  not_prepared: "Nothing prepared the wallet for this product yet.",
  stripe_declined:
    "Stripe found no way to pay with Apple Pay: no card in Wallet, the domain is not registered with Stripe, or Safari's Apple Pay check setting is off.",
  stripe_check_failed: "Stripe's Apple Pay check threw.",
  stripe_load_failed: "Stripe.js did not load or could not set up the wallet.",
  missing_public_api_key: "The host supplied no public API key.",
  session_failed: "Fetching the product's checkout session failed.",
  session_unsupported: "The product's checkout session cannot be paid with Apple Pay.",
  show_failed: "The wallet failed to open on the last tap.",
};

type ApplePaySessionGlobal = { canMakePayments?: () => unknown };

const unavailable = (reason: ApplePayUnavailableReason, error?: ApplePayError): UseApplePayResult =>
  error === undefined
    ? { available: false, reason, message: MESSAGES[reason] }
    : { available: false, reason, message: MESSAGES[reason], error };

const isCrossOriginFrame = (): boolean => {
  if (window.top === window.self) return false;
  try {
    return window.top?.location.origin !== window.location.origin;
  } catch {
    return true;
  }
};

const reasonOfThrow = (error: ApplePayError): ApplePayUnavailableReason => {
  if (/insecure/i.test(error.message)) return "insecure_context";
  if (isCrossOriginFrame()) return "cross_origin_frame";
  return "check_failed";
};

const checkApplePay = (): UseApplePayResult => {
  const global = (window as typeof window & { ApplePaySession?: ApplePaySessionGlobal })
    .ApplePaySession;
  if (window.isSecureContext === false) return unavailable("insecure_context");
  if (typeof global?.canMakePayments !== "function") return unavailable("unsupported_browser");
  try {
    return global.canMakePayments() === true
      ? { available: true }
      : unavailable("device_unsupported");
  } catch (thrown) {
    const error = applePayErrorOf(thrown);
    return unavailable(reasonOfThrow(error), error);
  }
};

const subscribeToNothing = () => () => {};

const sameStatus = (a: ApplePayAvailability, b: ApplePayAvailability): boolean =>
  a.status === b.status &&
  (a.status !== "unavailable" ||
    (b.status === "unavailable" && a.reason === b.reason && a.error === b.error));

const productStatusReader = (applePay: ApplePay | undefined, reference: string | undefined) => {
  let last: ApplePayAvailability | undefined;
  return (): ApplePayAvailability | undefined => {
    if (!applePay || reference === undefined) return undefined;
    const next = applePay.availability(reference);
    if (!last || !sameStatus(last, next)) last = next;
    return last;
  };
};

const productStatusOf = (
  device: UseApplePayResult,
  wallet: ApplePayAvailability,
): ApplePayProductStatus => {
  const failure = device.available ? wallet : device;
  if (!("reason" in failure))
    return wallet.status === "ready" ? { status: "ready" } : { status: "preparing" };
  const status: ApplePayProductStatus = {
    status: "unavailable",
    reason: failure.reason,
    message: MESSAGES[failure.reason],
  };
  return failure.error === undefined ? status : { ...status, error: failure.error };
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
 * }, [applePay?.available, prefetch, reference]);
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
  const wallet = React.useSyncExternalStore(
    applePay ? applePay.subscribe : subscribeToNothing,
    read,
    read,
  );
  return React.useMemo(() => {
    if (!device) return undefined;
    return wallet ? { ...device, product: productStatusOf(device, wallet) } : device;
  }, [device, wallet]);
}
