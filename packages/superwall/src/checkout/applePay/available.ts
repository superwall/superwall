import { TELEPORT_MARKS, markTeleportPage } from "../teleport/timing";
import { applePayErrorOf, type ApplePayError } from "./index";

/**
 * Why Apple Pay is not available on this device, or not known yet.
 *
 * - `"checking"`: Apple has not answered yet. It answers in a moment, at most
 *   1.5 seconds; a paywall with `teleport` in its config asks as it opens, so
 *   the answer is usually there before the first tap.
 * - `"no_active_card"`: Apple answered that Apple Pay has no card to pay with
 *   here: Wallet holds none, or the device cannot use Apple Pay.
 * - `"unsupported_browser"`: the page has no
 *   `ApplePaySession.canMakePaymentsWithActiveCard`,
 *   as inside the Android SDK, in Chrome, Firefox or Edge on a desktop, and in
 *   Studio in those browsers. The card sheet may still offer Apple Pay there
 *   through a QR code scanned with an iPhone, which is not direct Apple Pay.
 * - `"insecure_context"`: the page is not served over HTTPS. Safari offers
 *   Apple Pay only on HTTPS pages, `http://localhost` included.
 * - `"cross_origin_frame"`: the paywall runs in a frame of another origin and
 *   the browser refused the check there.
 * - `"check_failed"`: the browser threw on the check for another reason;
 *   `error` holds it.
 * - `"timed_out"`: Apple did not answer within 1.5 seconds. Its late answer
 *   still replaces this one, and the next check asks Apple again.
 */
export type ApplePayUnavailableReason =
  | "checking"
  | "no_active_card"
  | "unsupported_browser"
  | "insecure_context"
  | "cross_origin_frame"
  | "check_failed"
  | "timed_out";

/**
 * Whether Apple Pay is set up with a card on this device, from Apple's
 * `ApplePaySession.canMakePaymentsWithActiveCard()` for the page's own Stripe
 * merchant (`merchant.<hostname>.stripe`). It answers the same way on every
 * host: inside the iOS SDK, on the web, and on a teleport page. Any usable
 * card counts, Apple Cash with no balance too, so `available` means Apple Pay
 * is set up, not that a payment will go through.
 */
export type UseApplePayResult =
  | {
      /** Apple Pay is set up with a card on this device. */
      available: true;
    }
  | {
      /** Apple Pay is not set up on this device, or Apple has not answered yet. */
      available: false;
      /** Why not. See `ApplePayUnavailableReason`. */
      reason: ApplePayUnavailableReason;
      /** The reason in a sentence, in English, for logs and debugging. */
      message: string;
      /** What the browser threw, when the check threw. */
      error?: ApplePayError;
    };

export const APPLE_PAY_MESSAGES: Record<ApplePayUnavailableReason, string> = {
  checking: "Apple has not answered the Apple Pay check yet.",
  no_active_card: "Apple Pay has no card to pay with here: Wallet holds none.",
  unsupported_browser:
    "This page has no ApplePaySession.canMakePaymentsWithActiveCard, so it cannot check for a card.",
  insecure_context: "Apple Pay needs the page to be served over HTTPS.",
  cross_origin_frame: "The browser refused the Apple Pay check in a frame of another origin.",
  check_failed: "The browser threw on the Apple Pay check.",
  timed_out: "Apple did not answer the Apple Pay check in time.",
};

const APPLE_PAY_TIMEOUT_MS = 1500;

type ApplePaySessionGlobal = {
  canMakePaymentsWithActiveCard?: (merchantIdentifier: string) => unknown;
};

const applePaySession = (): ApplePaySessionGlobal | undefined =>
  (window as typeof window & { ApplePaySession?: ApplePaySessionGlobal }).ApplePaySession;

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

type Unavailable = Extract<UseApplePayResult, { available: false }>;

const unavailable = (reason: ApplePayUnavailableReason, error?: ApplePayError): Unavailable =>
  error === undefined
    ? { available: false, reason, message: APPLE_PAY_MESSAGES[reason] }
    : { available: false, reason, message: APPLE_PAY_MESSAGES[reason], error };

const thrown = (value: unknown): Unavailable => {
  const error = applePayErrorOf(value);
  return unavailable(reasonOfThrow(error), error);
};

const AVAILABLE: UseApplePayResult = { available: true };
const CHECKING = unavailable("checking");
const NO_ACTIVE_CARD = unavailable("no_active_card");
const UNSUPPORTED_BROWSER = unavailable("unsupported_browser");
const INSECURE_CONTEXT = unavailable("insecure_context");
const TIMED_OUT = unavailable("timed_out");

type Check = {
  result: UseApplePayResult;
  asked: boolean;
  asking: boolean;
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<() => void>;
};

const checks = new WeakMap<ApplePaySessionGlobal, Check>();

const askable = (): ApplePaySessionGlobal | UseApplePayResult => {
  if (window.isSecureContext === false) return INSECURE_CONTEXT;
  const global = applePaySession();
  if (typeof global?.canMakePaymentsWithActiveCard !== "function") return UNSUPPORTED_BROWSER;
  return global;
};

const checkOf = (global: ApplePaySessionGlobal): Check => {
  const known = checks.get(global);
  if (known) return known;
  const check: Check = {
    result: CHECKING,
    asked: false,
    asking: false,
    listeners: new Set(),
  };
  checks.set(global, check);
  return check;
};

const settle = (check: Check, result: UseApplePayResult) => {
  check.result = result;
  for (const listener of check.listeners) listener();
};

const answered = (check: Check, result: UseApplePayResult) => {
  check.asking = false;
  clearTimeout(check.timer);
  settle(check, result);
};

const ask = (global: ApplePaySessionGlobal, check: Check) => {
  if (check.result === TIMED_OUT) {
    check.asking = false;
    settle(check, CHECKING);
  }
  if (check.asking) return;
  if (check.asked && !check.result.available && check.result.error !== undefined) {
    settle(check, CHECKING);
  }
  check.asked = true;
  if (check.result !== CHECKING) return;
  check.asking = true;
  check.timer = setTimeout(() => {
    if (check.asking) settle(check, TIMED_OUT);
  }, APPLE_PAY_TIMEOUT_MS);
  new Promise<unknown>((resolve) => {
    markTeleportPage(TELEPORT_MARKS.applePayAsked);
    try {
      resolve(
        global.canMakePaymentsWithActiveCard?.(`merchant.${window.location.hostname}.stripe`),
      );
    } finally {
      markTeleportPage(TELEPORT_MARKS.applePayReturned);
    }
  }).then(
    (value) => answered(check, value === true ? AVAILABLE : NO_ACTIVE_CARD),
    (error: unknown) => answered(check, thrown(error)),
  );
};

export const readApplePay = (): UseApplePayResult => {
  const global = askable();
  return "available" in global ? global : checkOf(global).result;
};

export const startApplePayCheck = (): void => {
  const global = askable();
  if (!("available" in global)) ask(global, checkOf(global));
};

export const subscribeToApplePay = (listener: () => void): (() => void) => {
  const global = askable();
  if ("available" in global) return () => {};
  const check = checkOf(global);
  check.listeners.add(listener);
  ask(global, check);
  return () => check.listeners.delete(listener);
};

/**
 * Whether Apple Pay is available on this device, for code outside React;
 * `useApplePay()` is the same answer in a component. Apple is asked once per
 * page and its answer is reused. After 1.5 seconds without an answer it
 * resolves `timed_out`, but the check goes on, so Apple's late answer still
 * lands; a later call while it is still `timed_out` asks Apple again. A check
 * that threw is asked again next time. It never rejects and
 * never resolves `checking`. See `UseApplePayResult`.
 *
 * ```ts
 * const teleport = (await checkApplePay()).available;
 * ```
 */
export const checkApplePay = (): Promise<UseApplePayResult> =>
  new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    const done = (): boolean => {
      const result = readApplePay();
      if (result === CHECKING) return false;
      unsubscribe?.();
      resolve(result);
      return true;
    };
    startApplePayCheck();
    if (done()) return;
    unsubscribe = subscribeToApplePay(() => void done());
  });
