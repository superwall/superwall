import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import type {
  ApplePay,
  ApplePayAvailability,
  ApplePayError,
  ApplePayWalletReason,
} from "../checkout/applePay";
import {
  APPLE_PAY_MESSAGES,
  readApplePay,
  subscribeToApplePay,
  type ApplePayUnavailableReason,
  type UseApplePayResult,
} from "../checkout/applePay/available";
import { applePayFor } from "../checkout/flow";
import { hostOf, WEB_HOSTS } from "../host";
import { useSuperwallSession } from "../provider/context";
import type { ProductReference } from "./index";

export type { ApplePayError, ApplePayUnavailableReason, ApplePayWalletReason, UseApplePayResult };
export { checkApplePay } from "../checkout/applePay/available";

/**
 * Why the wallet cannot open for a product: `"unsupported_host"` inside the
 * iOS and Android SDKs and in Studio, where a purchase never opens the Apple
 * Pay wallet; the device's reason when Apple Pay is not available; otherwise
 * the product's.
 */
export type ApplePayProductReason =
  | "unsupported_host"
  | Exclude<ApplePayUnavailableReason, "checking">
  | ApplePayWalletReason;

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
  ...APPLE_PAY_MESSAGES,
  unsupported_host:
    "Inside the iOS or Android SDK and in Studio a purchase never opens the Apple Pay wallet.",
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

const subscribeToNothing = () => () => {};

const sameStatus = (a: ApplePayAvailability, b: ApplePayAvailability): boolean =>
  a.status === b.status &&
  (a.status !== "unavailable" ||
    (b.status === "unavailable" && a.reason === b.reason && a.error === b.error));

const NOT_PREPARED: ApplePayAvailability = { status: "unavailable", reason: "not_prepared" };

const productStatusReader = (applePay: ApplePay | undefined, reference: string | undefined) => {
  let last: ApplePayAvailability | undefined;
  return (): ApplePayAvailability => {
    if (!applePay || reference === undefined) return NOT_PREPARED;
    const next = applePay.availability(reference);
    if (!last || !sameStatus(last, next)) last = next;
    return last;
  };
};

const PREPARING: ApplePayProductStatus = { status: "preparing" };
const UNSUPPORTED_HOST: ApplePayProductStatus = {
  status: "unavailable",
  reason: "unsupported_host",
  message: MESSAGES.unsupported_host,
};

const productStatusOf = (
  device: UseApplePayResult,
  wallet: ApplePayAvailability,
): ApplePayProductStatus => {
  if (!device.available && device.reason === "checking") return PREPARING;
  const failure = device.available ? wallet : device;
  if (!("reason" in failure)) return failure.status === "ready" ? { status: "ready" } : PREPARING;
  const reason = failure.reason as ApplePayProductReason;
  const status: ApplePayProductStatus = {
    status: "unavailable",
    reason,
    message: MESSAGES[reason],
  };
  return failure.error === undefined ? status : { ...status, error: failure.error };
};

/**
 * Whether Apple Pay is available on this device: set up with a card, from
 * Apple's own check, answered the same way inside the iOS SDK, on the web and
 * on a teleport page. `available` is `false` with reason `"checking"` until
 * Apple answers, usually right after the first render and at most 1.5
 * seconds; answers already known, such as no Apple Pay at all on Android or
 * an answer the page got earlier, are there on the first render. Apple is
 * asked once per page and its answer is reused; a paywall with `teleport` in
 * its config asks as it opens. See `UseApplePayResult`.
 *
 * Teleport pays off only when the shopper can pay with Apple Pay on the web
 * page, so check `available` before sending them there and keep them in the
 * app otherwise:
 *
 * ```tsx
 * const applePay = useApplePay();
 * const onContinue = () =>
 *   applePay.available ? router.push("checkout", { teleport: true }) : purchase("annual");
 * ```
 *
 * With a product it also says whether the wallet is ready to open for that
 * product on a web host, which is the only answer that knows about the
 * domain's Stripe registration, and re-renders as the checkout prepares it.
 * On a paywall whose config `checkout` is `"sheet"`, prefetch the product for
 * Apple Pay before the tap; with `checkout: "applePay"` the paywall does it on
 * its own. With any other config `checkout` a Stripe purchase opens the hosted
 * checkout whatever the call asks for.
 *
 * ```tsx
 * const { purchase, prefetch } = usePurchase();
 * const applePay = useApplePay(reference);
 * useEffect(() => {
 *   if (applePay.available) prefetch(reference, { checkout: "applePay" });
 * }, [applePay.available, prefetch, reference]);
 * return applePay.product.status === "ready" ? (
 *   <button onClick={() => purchase(reference, { checkout: "applePay" })}>Apple Pay</button>
 * ) : (
 *   <button onClick={() => purchase(reference, { checkout: "sheet" })}>Pay with card</button>
 * );
 * ```
 */
export function useApplePay(): UseApplePayResult;
export function useApplePay(product: ProductReference | SuperwallProduct): UseApplePayProductResult;
export function useApplePay(
  product?: ProductReference | SuperwallProduct,
): UseApplePayResult | UseApplePayProductResult {
  const session = useSuperwallSession();
  const web = React.useMemo(() => WEB_HOSTS.has(hostOf()), []);
  const device = React.useSyncExternalStore(subscribeToApplePay, readApplePay, readApplePay);
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
    if (reference === undefined) return device;
    return { ...device, product: web ? productStatusOf(device, wallet) : UNSUPPORTED_HOST };
  }, [device, wallet, reference, web]);
}
