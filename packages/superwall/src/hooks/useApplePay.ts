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
 * `useApplePay(product)` reports that as `product`. `useApplePayCard()` checks
 * for a card on every host, in the app too.
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

/**
 * Why `useApplePayCard()` or `checkApplePayCard()` cannot say that Apple Pay
 * is set up with a card.
 *
 * - `"no_active_card"`: Apple answered that Apple Pay has no card to pay
 *   with here: Wallet holds none, or the device cannot use Apple Pay.
 * - `"unsupported_browser"`: the page has no
 *   `ApplePaySession.canMakePaymentsWithActiveCard`, as inside the Android
 *   SDK, in Chrome or Firefox on a desktop, and in Studio in those browsers.
 * - `"insecure_context"`: the page is not served over HTTPS.
 * - `"cross_origin_frame"`: the paywall runs in a frame of another origin and
 *   the browser refused the check there.
 * - `"check_failed"`: Apple's check threw for another reason; `error` holds it.
 * - `"timed_out"`: Apple did not answer within 1.5 seconds.
 */
export type ApplePayCardReason =
  | "no_active_card"
  | "unsupported_browser"
  | "insecure_context"
  | "cross_origin_frame"
  | "check_failed"
  | "timed_out";

/**
 * Whether Apple Pay is set up with a card on this device, from Apple's
 * `ApplePaySession.canMakePaymentsWithActiveCard` for the page's own Stripe
 * merchant (`merchant.<hostname>.stripe`). It answers inside the iOS SDK and
 * on every web host, the teleport page included. Any usable card counts,
 * Apple Cash with no balance too, so `"ready"` means Apple Pay is set up, not
 * that a payment will go through.
 */
export type ApplePayCardResult =
  | {
      /** Apple Pay is set up with a card. */
      status: "ready";
    }
  | {
      /** Apple Pay is not set up with a card, or the page could not ask. */
      status: "unavailable";
      /** Why. See `ApplePayCardReason`. */
      reason: ApplePayCardReason;
      /** The reason in a sentence, in English, for logs and debugging. */
      message: string;
      /** What the browser threw, when the check threw. */
      error?: ApplePayError;
    };

/** The result of `useApplePayCard()`: `"checking"` until Apple answers, then an `ApplePayCardResult`. */
export type UseApplePayCardResult =
  | {
      /** Apple has not answered yet. */
      status: "checking";
    }
  | ApplePayCardResult;

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

const CARD_MESSAGES: Record<ApplePayCardReason, string> = {
  no_active_card:
    "Apple Pay has no card to pay with here: Wallet holds none, or the device cannot use Apple Pay.",
  unsupported_browser:
    "This page has no ApplePaySession.canMakePaymentsWithActiveCard, so it cannot check for a card.",
  insecure_context: MESSAGES.insecure_context,
  cross_origin_frame: MESSAGES.cross_origin_frame,
  check_failed: "The browser threw on the Apple Pay card check.",
  timed_out: "Apple did not answer the Apple Pay card check in time.",
};

/** How long `checkApplePayCard()` waits for Apple's answer before it reports `timed_out`. */
const APPLE_PAY_CARD_TIMEOUT_MS = 1500;

type ApplePaySessionGlobal = {
  canMakePayments?: () => unknown;
  canMakePaymentsWithActiveCard?: (merchantIdentifier: string) => unknown;
};

const applePaySession = (): ApplePaySessionGlobal | undefined =>
  (window as typeof window & { ApplePaySession?: ApplePaySessionGlobal }).ApplePaySession;

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

const reasonOfThrow = (
  error: ApplePayError,
): "insecure_context" | "cross_origin_frame" | "check_failed" => {
  if (/insecure/i.test(error.message)) return "insecure_context";
  if (isCrossOriginFrame()) return "cross_origin_frame";
  return "check_failed";
};

const checkApplePay = (): UseApplePayResult => {
  const global = applePaySession();
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

const cardUnavailable = (reason: ApplePayCardReason, error?: ApplePayError): ApplePayCardResult =>
  error === undefined
    ? { status: "unavailable", reason, message: CARD_MESSAGES[reason] }
    : { status: "unavailable", reason, message: CARD_MESSAGES[reason], error };

type CardQuestion = {
  global: ApplePaySessionGlobal;
  ask: (merchantIdentifier: string) => unknown;
};

const cardAnswers = new WeakMap<ApplePaySessionGlobal, Promise<ApplePayCardResult>>();
const cardResults = new WeakMap<ApplePaySessionGlobal, ApplePayCardResult>();

const cardQuestion = (): ApplePayCardResult | CardQuestion => {
  if (window.isSecureContext === false) return cardUnavailable("insecure_context");
  const global = applePaySession();
  const ask = global?.canMakePaymentsWithActiveCard;
  if (global === undefined || typeof ask !== "function") {
    return cardUnavailable("unsupported_browser");
  }
  return cardResults.get(global) ?? { global, ask };
};

const askApple = ({ global, ask }: CardQuestion): Promise<ApplePayCardResult> => {
  const asked = cardAnswers.get(global);
  if (asked) return asked;
  const answer = new Promise<unknown>((resolve) => {
    resolve(ask.call(global, `merchant.${window.location.hostname}.stripe`));
  }).then(
    (value): ApplePayCardResult => {
      const result: ApplePayCardResult =
        value === true ? { status: "ready" } : cardUnavailable("no_active_card");
      cardResults.set(global, result);
      return result;
    },
    (thrown: unknown) => {
      cardAnswers.delete(global);
      const error = applePayErrorOf(thrown);
      return cardUnavailable(reasonOfThrow(error), error);
    },
  );
  cardAnswers.set(global, answer);
  return answer;
};

const withinTimeout = (answer: Promise<ApplePayCardResult>): Promise<ApplePayCardResult> =>
  new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve(cardUnavailable("timed_out")),
      APPLE_PAY_CARD_TIMEOUT_MS,
    );
    void answer.then((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });

/**
 * Whether Apple Pay is set up with a card on this device, for code outside
 * React; `useApplePayCard()` is the hook. Apple is asked once per page and its
 * answer is reused; a check that threw or timed out is asked again next time.
 * It never rejects. See `ApplePayCardResult`.
 *
 * ```ts
 * const teleport = (await checkApplePayCard()).status === "ready";
 * ```
 */
export const checkApplePayCard = (): Promise<ApplePayCardResult> => {
  const question = cardQuestion();
  return "status" in question ? Promise.resolve(question) : withinTimeout(askApple(question));
};

/**
 * Whether Apple Pay is set up with a card on this device, in the app (iOS SDK)
 * and on the web alike: `"checking"` until Apple answers, usually right after
 * the first render, then `"ready"` or `"unavailable"` with a reason. Answers
 * already known, such as no Apple Pay at all on Android, are there on the first
 * render. See `ApplePayCardResult`.
 *
 * Teleport pays off only when the shopper can pay with Apple Pay on the web
 * page, so check this before sending them there and keep them in the app
 * otherwise:
 *
 * ```tsx
 * const card = useApplePayCard();
 * const onContinue = () =>
 *   card.status === "ready" ? router.push("checkout", { teleport: true }) : purchase("annual");
 * ```
 */
export const useApplePayCard = (): UseApplePayCardResult => {
  const [card, setCard] = React.useState<UseApplePayCardResult>(() => {
    const question = cardQuestion();
    return "status" in question ? question : { status: "checking" };
  });
  React.useEffect(() => {
    if (card.status !== "checking") return undefined;
    let live = true;
    void checkApplePayCard().then((result) => {
      if (live) setCard(result);
    });
    return () => {
      live = false;
    };
  }, [card.status]);
  return card;
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
