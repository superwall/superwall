import type { loadStripe as loadStripeFn, Stripe } from "@stripe/stripe-js";
import { fetchWithRetry as defaultFetchWithRetry } from "../api/fetch";
import { createConfirmation } from "./confirm";
import { failureOfError, unknownFailure } from "../failure";
import { checkoutEvents } from "../events";
import type { HostContext, HostEvents } from "../host";
import { buildCheckoutSessionId, stripeEnvironmentOf } from "../session/id";
import type {
  CustomerIdentity,
  ElementsCheckoutSession,
  ElementsPaymentSession,
  WebPurchaseOutcome,
} from "../types";

/** An error a browser or Stripe threw, as its name and message. */
export type CheckoutError = {
  /** The error's name, such as `"IntegrationError"`. */
  name: string;
  /** The error's message, as the browser or Stripe wrote it. */
  message: string;
};

export const checkoutErrorOf = (error: unknown): CheckoutError =>
  error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };

/**
 * Why a product's checkout form cannot take payment.
 *
 * - `"not_prepared"`: nothing asked for the product's checkout yet.
 * - `"missing_public_api_key"`: the host supplied no public API key.
 * - `"session_failed"`: fetching the product's checkout failed; `error`
 *   holds it.
 * - `"session_unsupported"`: the backend can't take this product's payment
 *   in a form, such as a one-time price or an account on Stripe managed
 *   payments. A plain `purchase()` still opens the sheet.
 * - `"stripe_load_failed"`: Stripe.js did not load; `error` holds what it
 *   threw, when it threw.
 */
export type ElementsUnavailableReason =
  | "not_prepared"
  | "missing_public_api_key"
  | "session_failed"
  | "session_unsupported"
  | "stripe_load_failed";

export type ElementsUnavailable = {
  status: "unavailable";
  reason: ElementsUnavailableReason;
  error?: CheckoutError;
};

export type ElementsQuote =
  | { status: "preparing" }
  | { status: "ready"; quote: ElementsCheckoutSession; stripe: Stripe }
  | ElementsUnavailable;

/** The payment method a form collected, ready to pay with. */
export type CollectedPayment = {
  paymentMethodId: string;
  email?: string;
};

export type ElementsCheckoutOptions = {
  publicApiKey: () => string;
  host: HostEvents;
  loadStripe?: typeof loadStripeFn;
  fetchWithRetry?: typeof defaultFetchWithRetry;
  confirmUrl?: () => string;
};

export type ElementsCheckout = {
  quoteOf(referenceName: string): ElementsQuote;
  preparing(referenceName: string): void;
  markUnavailable(referenceName: string, reason: ElementsUnavailableReason, error?: unknown): void;
  prepare(quote: ElementsCheckoutSession, identity?: CustomerIdentity): Promise<void>;
  pay(
    referenceName: string,
    payment: CollectedPayment,
    context: HostContext,
    onSubmit?: () => void,
  ): Promise<WebPurchaseOutcome>;
  clear(): void;
  subscribe(listener: () => void): () => void;
};

type Ready = Extract<ElementsQuote, { status: "ready" }> & { identity: CustomerIdentity };

type Stored = Ready | ElementsUnavailable | { status: "preparing" };

const NOT_PREPARED: ElementsUnavailable = { status: "unavailable", reason: "not_prepared" };

export const createElementsCheckout = (options: ElementsCheckoutOptions): ElementsCheckout => {
  const quotes = new Map<string, Stored>();
  const tokens = new Map<string, object>();
  const paying = new Set<string>();
  const listeners = new Set<() => void>();
  const confirmation = createConfirmation(options);

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const set = (referenceName: string, state: Stored) => {
    tokens.delete(referenceName);
    quotes.set(referenceName, state);
    notify();
  };

  const markUnavailable = (
    referenceName: string,
    reason: ElementsUnavailableReason,
    error?: unknown,
  ) =>
    set(
      referenceName,
      error === undefined
        ? { status: "unavailable", reason }
        : { status: "unavailable", reason, error: checkoutErrorOf(error) },
    );

  const stripes = new Map<string, Promise<Stripe | null>>();
  const stripeFor = (publishableKey: string): Promise<Stripe | null> => {
    const loading = stripes.get(publishableKey);
    if (loading) return loading;
    const load = (async () => {
      const loadStripe = options.loadStripe ?? (await import("@stripe/stripe-js/pure")).loadStripe;
      return loadStripe(publishableKey, { developerTools: { assistant: { enabled: false } } });
    })();
    stripes.set(publishableKey, load);
    void load.then(
      (stripe) => {
        if (!stripe) stripes.delete(publishableKey);
      },
      () => stripes.delete(publishableKey),
    );
    return load;
  };

  return {
    quoteOf: (referenceName) => quotes.get(referenceName) ?? NOT_PREPARED,

    preparing: (referenceName) => set(referenceName, { status: "preparing" }),

    markUnavailable,

    prepare: async (quote, identity = {}) => {
      const { referenceName } = quote;
      set(referenceName, { status: "preparing" });
      if (!options.publicApiKey()) {
        markUnavailable(referenceName, "missing_public_api_key");
        return;
      }
      const token = {};
      tokens.set(referenceName, token);
      const stripe = await stripeFor(quote.publishableKey);
      if (tokens.get(referenceName) !== token) return;
      if (!stripe) {
        markUnavailable(referenceName, "stripe_load_failed");
        return;
      }
      set(referenceName, { status: "ready", quote, stripe, identity });
    },

    pay: async (referenceName, payment, context, onSubmit) => {
      const state = quotes.get(referenceName);
      if (state?.status !== "ready" || paying.has(referenceName)) {
        return { status: "failed", failure: unknownFailure() };
      }
      paying.add(referenceName);
      const { quote, stripe, identity } = state;
      const session: ElementsPaymentSession = {
        directive: "elements",
        referenceName,
        checkoutContextId: quote.checkoutContextId,
        checkoutSessionId: null,
        ...(quote.postPurchaseBehavior ? { postPurchaseBehavior: quote.postPurchaseBehavior } : {}),
      };

      checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session });
      onSubmit?.();
      options.host.submitted(context);

      try {
        await confirmation.confirm({
          name: "Elements",
          stripe,
          quote,
          paymentMethodId: payment.paymentMethodId,
          stripeCustomerId: identity.stripeCustomerId,
          email: payment.email || identity.email,
          onAuthorized: () => undefined,
          onSubscription: (subscriptionId) => {
            session.checkoutSessionId ??= buildCheckoutSessionId({
              stripeCheckoutSessionId: subscriptionId,
              environment: stripeEnvironmentOf(context.productIdentifier),
            });
          },
        });
        checkoutEvents.dispatch("PAYMENT_SUCCESS", { session });
        return { status: "completed" };
      } catch (error) {
        const failure = failureOfError(error);
        checkoutEvents.dispatch("PAYMENT_ERROR", {
          error: error instanceof Error ? error : new Error("Payment failed"),
          session,
          failure,
        });
        options.host.failed(context);
        return { status: "failed", failure };
      } finally {
        paying.delete(referenceName);
      }
    },

    clear: () => {
      quotes.clear();
      tokens.clear();
      notify();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
