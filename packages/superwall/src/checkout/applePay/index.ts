import type {
  loadStripe as loadStripeFn,
  PaymentRequest,
  PaymentRequestPaymentMethodEvent,
  Stripe,
} from "@stripe/stripe-js";
import { buildApplePayConfig, buildApplePayLineItems } from "./request";
import { fetchWithRetry as defaultFetchWithRetry } from "../api/fetch";
import { createConfirmation } from "../elements/confirm";
import { failureOfError, unknownFailure, type CheckoutFailure } from "../failure";
import { checkoutEvents } from "../events";
import type { HostEvents, HostContext } from "../host";
import { startLoading, stopLoading } from "../loading";
import { buildCheckoutSessionId, stripeEnvironmentOf } from "../session/id";
import type { ApplePaySession, CustomerIdentity, ElementsCheckoutSession } from "../types";

/**
 * Why the Apple Pay wallet is not ready to open for a product, once the
 * browser itself can open it.
 *
 * - `"not_prepared"`: nothing prepared the wallet for the product yet,
 *   neither the config's `checkout: "applePay"` nor a
 *   `prefetch(product, { checkout: "applePay" })`. It says nothing about the
 *   device.
 * - `"stripe_declined"`: Stripe's check found no way to pay with Apple Pay:
 *   no card is set up in Wallet, the domain is not registered for Apple Pay
 *   with Stripe, or Safari's "Allow websites to check for Apple Pay" setting
 *   is off. Stripe does not say which.
 * - `"stripe_check_failed"`: Stripe's check threw; `error` holds it.
 * - `"stripe_load_failed"`: Stripe.js did not load or could not set up the
 *   wallet; `error` holds what it threw, when it threw.
 * - `"missing_public_api_key"`: the host supplied no public API key.
 * - `"session_failed"`: fetching the product's checkout session failed;
 *   `error` holds it.
 * - `"session_unsupported"`: the backend's checkout session for the product
 *   cannot be paid with Apple Pay.
 * - `"show_failed"`: the wallet failed to open on the last tap; `error`
 *   holds it.
 */
export type ApplePayWalletReason =
  | "not_prepared"
  | "stripe_declined"
  | "stripe_check_failed"
  | "stripe_load_failed"
  | "missing_public_api_key"
  | "session_failed"
  | "session_unsupported"
  | "show_failed";

/** An error a browser or Stripe threw, as its name and message. */
export type ApplePayError = {
  /** The error's name, such as `"InvalidAccessError"`. */
  name: string;
  /** The error's message, as the browser or Stripe wrote it. */
  message: string;
};

export const applePayErrorOf = (error: unknown): ApplePayError =>
  error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };

type Unavailable = { status: "unavailable"; reason: ApplePayWalletReason; error?: ApplePayError };

export type ApplePayOutcome =
  | { status: "completed" | "abandoned" }
  | { status: "failed"; failure: CheckoutFailure }
  | Unavailable
  | { status: "unavailable"; reason: "cleared" };

export type ApplePayAvailability = { status: "preparing" } | { status: "ready" } | Unavailable;

export type ApplePayOptions = {
  publicApiKey: () => string;
  host: HostEvents;
  loadStripe?: typeof loadStripeFn;
  fetchWithRetry?: typeof defaultFetchWithRetry;
  confirmUrl?: () => string;
};

export type ApplePay = {
  availability(referenceName: string): ApplePayAvailability;
  markUnavailable(referenceName: string, reason: ApplePayWalletReason, error?: unknown): void;
  prepare(quote: ElementsCheckoutSession, identity?: CustomerIdentity): Promise<void>;
  purchase(
    referenceName: string,
    context: HostContext,
    onSubmit?: () => void,
  ): Promise<ApplePayOutcome>;
  clear(): void;
  subscribe(listener: () => void): () => void;
};

type Prepared = {
  quote: ElementsCheckoutSession;
  identity: CustomerIdentity;
  stripe: Stripe;
  paymentRequest: PaymentRequest;
  session: ApplePaySession;
  context: HostContext | null;
  onSubmit?: () => void;
  ready: boolean;
  inProgress: boolean;
  authorized: boolean;
  settle: ((outcome: ApplePayOutcome) => void) | null;
};

type Pending = {
  context: HostContext;
  onSubmit?: () => void;
  resolve: (outcome: ApplePayOutcome) => void;
};

type WalletState = { status: "ready"; prepared: Prepared } | { status: "preparing" } | Unavailable;

const recordSubscription = (ready: Prepared, subscriptionId: string) => {
  if (ready.session.checkoutSessionId) return;
  ready.session.checkoutSessionId = buildCheckoutSessionId({
    stripeCheckoutSessionId: subscriptionId,
    environment: stripeEnvironmentOf(ready.context?.productIdentifier),
  });
};

const totalAmountOf = (quote: ElementsCheckoutSession): number => {
  const { amountDueNow, amount } = quote.subscriptionDetails;
  if (typeof amountDueNow === "number") return amountDueNow;
  return quote.intentType === "SetupIntent" ? 0 : amount;
};

const defaultManagementUrl = (): string => new URL("/manage", window.location.origin).toString();

const NOT_PREPARED: Unavailable = { status: "unavailable", reason: "not_prepared" };

export const createApplePay = (options: ApplePayOptions): ApplePay => {
  const prepared = new Map<string, Prepared>();
  const unavailable = new Map<string, Unavailable | "preparing">();
  const pending = new Map<string, Pending>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const stateOf = (referenceName: string): WalletState => {
    const ready = prepared.get(referenceName);
    if (ready?.ready) return { status: "ready", prepared: ready };
    const state = unavailable.get(referenceName) ?? NOT_PREPARED;
    return state === "preparing" ? { status: "preparing" } : state;
  };

  const takePending = (referenceName: string): Pending | undefined => {
    const waiting = pending.get(referenceName);
    pending.delete(referenceName);
    return waiting;
  };

  const markUnavailable = (
    referenceName: string,
    reason: ApplePayWalletReason,
    error?: unknown,
  ) => {
    const state: Unavailable =
      error === undefined
        ? { status: "unavailable", reason }
        : { status: "unavailable", reason, error: applePayErrorOf(error) };
    prepared.delete(referenceName);
    unavailable.set(referenceName, state);
    notify();
    const waiting = takePending(referenceName);
    if (!waiting) return;
    stopLoading();
    waiting.resolve(state);
  };

  const confirmation = createConfirmation(options);

  const onPaymentMethod = async (ready: Prepared, event: PaymentRequestPaymentMethodEvent) => {
    ready.authorized = true;
    checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session: ready.session });
    ready.onSubmit?.();
    if (ready.context) options.host.submitted(ready.context);

    let completed = false;
    const complete = (status: "success" | "fail") => {
      if (completed) return;
      completed = true;
      try {
        event.complete(status);
      } catch {}
    };

    try {
      await confirmation.confirm({
        name: "Apple Pay",
        stripe: ready.stripe,
        quote: ready.quote,
        paymentMethodId: event.paymentMethod.id,
        stripeCustomerId: ready.identity.stripeCustomerId,
        email: event.payerEmail || ready.identity.email,
        onAuthorized: () => complete("success"),
        onSubscription: (subscriptionId) => recordSubscription(ready, subscriptionId),
      });

      checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: ready.session });
      ready.settle?.({ status: "completed" });
    } catch (error) {
      complete("fail");
      const failure = failureOfError(error);
      const reported = error instanceof Error ? error : new Error("Apple Pay failed");
      checkoutEvents.dispatch("PAYMENT_ERROR", {
        error: reported,
        session: ready.session,
        failure,
      });
      if (ready.context) options.host.failed(ready.context);
      ready.settle?.({ status: "failed", failure });
    }
  };

  const onCancel = (ready: Prepared) => {
    if (ready.authorized || !ready.settle) return;
    if (ready.context) options.host.abandoned(ready.context);
    ready.settle({ status: "abandoned" });
  };

  const show = (
    ready: Prepared,
    context: HostContext,
    onSubmit?: () => void,
  ): Promise<ApplePayOutcome> => {
    if (ready.inProgress) return Promise.resolve({ status: "failed", failure: unknownFailure() });

    ready.context = context;
    ready.onSubmit = onSubmit;
    ready.authorized = false;
    ready.inProgress = true;

    try {
      ready.paymentRequest.show();
    } catch (error) {
      ready.inProgress = false;
      markUnavailable(ready.quote.referenceName, "show_failed", error);
      return Promise.resolve({
        status: "unavailable",
        reason: "show_failed",
        error: applePayErrorOf(error),
      });
    }

    startLoading();
    options.host.initiated(context);

    return new Promise((resolve) => {
      ready.settle = (outcome) => {
        ready.settle = null;
        ready.inProgress = false;
        stopLoading();
        resolve(outcome);
      };
    });
  };

  return {
    availability: (referenceName) => {
      const state = stateOf(referenceName);
      return state.status === "ready" ? { status: "ready" } : state;
    },

    markUnavailable,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    clear: () => {
      prepared.clear();
      unavailable.clear();
      notify();
      for (const waiting of pending.values()) {
        waiting.resolve({ status: "unavailable", reason: "cleared" });
      }
      pending.clear();
    },

    purchase: (referenceName, context, onSubmit) => {
      const state = stateOf(referenceName);
      if (state.status === "ready") return show(state.prepared, context, onSubmit);
      if (state.status === "unavailable") return Promise.resolve(state);
      startLoading();
      return new Promise((resolve) => {
        pending.set(referenceName, { context, onSubmit, resolve });
      });
    },

    prepare: async (quote, identity = {}) => {
      const { referenceName } = quote;
      prepared.delete(referenceName);
      unavailable.set(referenceName, "preparing");
      notify();

      if (!options.publicApiKey()) {
        markUnavailable(referenceName, "missing_public_api_key");
        return;
      }

      const loadStripe = options.loadStripe ?? (await import("@stripe/stripe-js")).loadStripe;
      const stripe = await loadStripe(quote.publishableKey, {
        developerTools: { assistant: { enabled: false } },
      });
      if (!stripe) {
        markUnavailable(referenceName, "stripe_load_failed");
        return;
      }

      const details = quote.subscriptionDetails;
      const displayItems = buildApplePayLineItems(details);
      const paymentRequest = stripe.paymentRequest({
        country: (quote.stripeAccountCountryCode || "US").toUpperCase(),
        currency: details.currency.toLowerCase(),
        total: { label: details.productName || "Subscribe", amount: totalAmountOf(quote) },
        ...(displayItems ? { displayItems } : {}),
        requestPayerName: true,
        requestPayerEmail: true,
        disableWallets: ["googlePay", "link", "browserCard"],
        applePay: buildApplePayConfig(details, quote.managementUrl || defaultManagementUrl()),
      });

      const ready: Prepared = {
        quote,
        identity,
        stripe,
        paymentRequest,
        session: {
          directive: "applePay",
          referenceName,
          checkoutContextId: quote.checkoutContextId,
          checkoutSessionId: null,
          ...(quote.postPurchaseBehavior
            ? { postPurchaseBehavior: quote.postPurchaseBehavior }
            : {}),
        },
        context: null,
        ready: false,
        inProgress: false,
        authorized: false,
        settle: null,
      };

      paymentRequest.on("paymentmethod", (event) => void onPaymentMethod(ready, event));
      paymentRequest.on("cancel", () => onCancel(ready));

      try {
        const canMakePayment = await paymentRequest.canMakePayment();
        if (canMakePayment?.applePay !== true) {
          markUnavailable(referenceName, "stripe_declined");
          return;
        }
      } catch (error) {
        markUnavailable(referenceName, "stripe_check_failed", error);
        return;
      }

      ready.ready = true;
      unavailable.delete(referenceName);
      prepared.set(referenceName, ready);
      notify();
      const waiting = takePending(referenceName);
      if (waiting) void show(ready, waiting.context, waiting.onSubmit).then(waiting.resolve);
    },
  };
};
