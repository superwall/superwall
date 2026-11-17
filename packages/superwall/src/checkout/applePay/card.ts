import { applePayErrorOf, type ApplePayError } from "./index";

/**
 * Why `useApplePay().card` or `checkApplePayCard()` cannot say that Apple Pay
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
 * - `"timed_out"`: Apple did not answer within 1.5 seconds. A late answer
 *   still replaces it.
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

/** `useApplePay().card`: `"checking"` until Apple answers, then an `ApplePayCardResult`. */
export type ApplePayCardStatus =
  | {
      /** Apple has not answered yet. */
      status: "checking";
    }
  | ApplePayCardResult;

const MESSAGES: Record<ApplePayCardReason, string> = {
  no_active_card:
    "Apple Pay has no card to pay with here: Wallet holds none, or the device cannot use Apple Pay.",
  unsupported_browser:
    "This page has no ApplePaySession.canMakePaymentsWithActiveCard, so it cannot check for a card.",
  insecure_context: "Apple Pay needs the page to be served over HTTPS.",
  cross_origin_frame: "The browser refused the Apple Pay check in a frame of another origin.",
  check_failed: "The browser threw on the Apple Pay card check.",
  timed_out: "Apple did not answer the Apple Pay card check in time.",
};

const APPLE_PAY_CARD_TIMEOUT_MS = 1500;

export type ApplePaySessionGlobal = {
  canMakePayments?: () => unknown;
  canMakePaymentsWithActiveCard?: (merchantIdentifier: string) => unknown;
};

export const applePaySession = (): ApplePaySessionGlobal | undefined =>
  (window as typeof window & { ApplePaySession?: ApplePaySessionGlobal }).ApplePaySession;

const isCrossOriginFrame = (): boolean => {
  if (window.top === window.self) return false;
  try {
    return window.top?.location.origin !== window.location.origin;
  } catch {
    return true;
  }
};

export const reasonOfThrow = (
  error: ApplePayError,
): "insecure_context" | "cross_origin_frame" | "check_failed" => {
  if (/insecure/i.test(error.message)) return "insecure_context";
  if (isCrossOriginFrame()) return "cross_origin_frame";
  return "check_failed";
};

const unavailable = (reason: ApplePayCardReason, error?: ApplePayError): ApplePayCardResult =>
  error === undefined
    ? { status: "unavailable", reason, message: MESSAGES[reason] }
    : { status: "unavailable", reason, message: MESSAGES[reason], error };

const CHECKING: ApplePayCardStatus = { status: "checking" };
const READY: ApplePayCardResult = { status: "ready" };
const NO_ACTIVE_CARD = unavailable("no_active_card");
const UNSUPPORTED_BROWSER = unavailable("unsupported_browser");
const INSECURE_CONTEXT = unavailable("insecure_context");
const TIMED_OUT = unavailable("timed_out");

type CardCheck = {
  status: ApplePayCardStatus;
  asking: boolean;
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<() => void>;
};

const checks = new WeakMap<ApplePaySessionGlobal, CardCheck>();

const askable = (): ApplePaySessionGlobal | ApplePayCardResult => {
  if (window.isSecureContext === false) return INSECURE_CONTEXT;
  const global = applePaySession();
  if (typeof global?.canMakePaymentsWithActiveCard !== "function") return UNSUPPORTED_BROWSER;
  return global;
};

const checkOf = (global: ApplePaySessionGlobal): CardCheck => {
  const known = checks.get(global);
  if (known) return known;
  const check: CardCheck = { status: CHECKING, asking: false, listeners: new Set() };
  checks.set(global, check);
  return check;
};

const settle = (check: CardCheck, status: ApplePayCardStatus) => {
  check.status = status;
  for (const listener of check.listeners) listener();
};

const answered = (check: CardCheck, result: ApplePayCardResult) => {
  check.asking = false;
  clearTimeout(check.timer);
  settle(check, result);
};

const isRetryable = (status: ApplePayCardStatus): boolean =>
  status.status === "unavailable" && status.error !== undefined;

const ask = (global: ApplePaySessionGlobal, check: CardCheck) => {
  if (check.asking || (check.status !== CHECKING && !isRetryable(check.status))) return;
  check.asking = true;
  if (check.status !== CHECKING) settle(check, CHECKING);
  check.timer = setTimeout(() => {
    if (check.asking) settle(check, TIMED_OUT);
  }, APPLE_PAY_CARD_TIMEOUT_MS);
  new Promise<unknown>((resolve) => {
    resolve(global.canMakePaymentsWithActiveCard?.(`merchant.${window.location.hostname}.stripe`));
  }).then(
    (value) => answered(check, value === true ? READY : NO_ACTIVE_CARD),
    (thrown: unknown) => {
      const error = applePayErrorOf(thrown);
      answered(check, unavailable(reasonOfThrow(error), error));
    },
  );
};

export const readApplePayCard = (): ApplePayCardStatus => {
  const global = askable();
  return "status" in global ? global : checkOf(global).status;
};

export const startApplePayCardCheck = (): void => {
  const global = askable();
  if (!("status" in global)) ask(global, checkOf(global));
};

export const subscribeToApplePayCard = (listener: () => void): (() => void) => {
  const global = askable();
  if ("status" in global) return () => {};
  const check = checkOf(global);
  check.listeners.add(listener);
  ask(global, check);
  return () => check.listeners.delete(listener);
};

/**
 * Whether Apple Pay is set up with a card on this device, for code outside
 * React; `useApplePay().card` is the same answer in a component. Apple is
 * asked once per page and its answer is reused. After 1.5 seconds without an
 * answer it resolves `timed_out`, but the check goes on, so a later call gets
 * Apple's answer. A check that threw is asked again next time. It never
 * rejects. See `ApplePayCardResult`.
 *
 * ```ts
 * const teleport = (await checkApplePayCard()).status === "ready";
 * ```
 */
export const checkApplePayCard = (): Promise<ApplePayCardResult> =>
  new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    const done = (): boolean => {
      const status = readApplePayCard();
      if (status.status === "checking") return false;
      unsubscribe?.();
      resolve(status);
      return true;
    };
    startApplePayCardCheck();
    if (done()) return;
    unsubscribe = subscribeToApplePayCard(() => void done());
  });
