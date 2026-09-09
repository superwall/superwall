import type {
  loadStripe as loadStripeFn,
  PaymentIntent,
  PaymentRequest,
  PaymentRequestPaymentMethodEvent,
  SetupIntent,
  Stripe,
} from "@stripe/stripe-js";
import { buildApplePayConfig, buildApplePayLineItems } from "./request";
import { fetchWithRetry as defaultFetchWithRetry } from "../api/fetch";
import { errorMessageOf, field, intentTypeOf } from "../api/decode";
import { subscriptionsApiUrl } from "../api/url";
import { checkoutEvents } from "../events";
import type { HostEvents, HostContext } from "../host";
import { startLoading, stopLoading } from "../loading";
import {
  buildCheckoutSessionId,
  decodeCheckoutSessionId,
  stripeEnvironmentOf,
} from "../session/id";
import type { ApplePaySession, CustomerIdentity, ElementsCheckoutSession } from "../types";

export type ApplePayOutcome =
  | { status: "completed" | "abandoned" | "failed" }
  | { status: "unavailable"; reason: string };

export type ApplePayAvailability =
  | { status: "preparing" }
  | { status: "ready" }
  | { status: "unavailable"; reason: string };

export type ApplePayOptions = {
  publicApiKey: () => string;
  host: HostEvents;
  loadStripe?: typeof loadStripeFn;
  fetchWithRetry?: typeof defaultFetchWithRetry;
  confirmUrl?: () => string;
};

export type ApplePay = {
  availability(referenceName: string): ApplePayAvailability;
  markUnavailable(referenceName: string, reason: string): void;
  prepare(quote: ElementsCheckoutSession, identity?: CustomerIdentity): Promise<void>;
  purchase(referenceName: string, context: HostContext): Promise<ApplePayOutcome>;
  clear(): void;
};

type ConfirmResponse = {
  subscriptionId?: string;
  requiresAction: boolean;
  clientSecret?: string;
  intentType?: "SetupIntent" | "PaymentIntent";
  setupIntentId?: string;
};

const readConfirmResponse = (body: unknown): ConfirmResponse => {
  const subscriptionId = field(body, "subscriptionId");
  const clientSecret = field(body, "clientSecret");
  const setupIntentId = field(body, "setupIntentId");
  const intentType = intentTypeOf(field(body, "intentType"));
  return {
    requiresAction: field(body, "requiresAction") === true,
    ...(typeof subscriptionId === "string" ? { subscriptionId } : {}),
    ...(typeof clientSecret === "string" ? { clientSecret } : {}),
    ...(typeof setupIntentId === "string" ? { setupIntentId } : {}),
    ...(intentType ? { intentType } : {}),
  };
};

type Prepared = {
  quote: ElementsCheckoutSession;
  identity: CustomerIdentity;
  stripe: Stripe;
  paymentRequest: PaymentRequest;
  clientSecret: string | null;
  session: ApplePaySession;
  context: HostContext | null;
  ready: boolean;
  inProgress: boolean;
  authorized: boolean;
  settle: ((outcome: ApplePayOutcome) => void) | null;
};

type Pending = { context: HostContext; resolve: (outcome: ApplePayOutcome) => void };

type WalletState =
  | { status: "ready"; prepared: Prepared }
  | { status: "preparing" }
  | { status: "unavailable"; reason: string };

type Complete = (status: "success" | "fail") => void;

const recordConfirmation = (ready: Prepared, response: ConfirmResponse) => {
  if (!response.subscriptionId || ready.session.checkoutSessionId) return;
  ready.session.checkoutSessionId = buildCheckoutSessionId({
    stripeCheckoutSessionId: response.subscriptionId,
    environment: stripeEnvironmentOf(ready.context?.productIdentifier),
  });
};

const totalAmountOf = (quote: ElementsCheckoutSession): number => {
  const { amountDueNow, amount } = quote.subscriptionDetails;
  if (typeof amountDueNow === "number") return amountDueNow;
  return quote.intentType === "SetupIntent" ? 0 : amount;
};

const defaultManagementUrl = (): string => new URL("/manage", window.location.origin).toString();

export const createApplePay = (options: ApplePayOptions): ApplePay => {
  const prepared = new Map<string, Prepared>();
  const unavailable = new Map<string, string>();
  const pending = new Map<string, Pending>();

  const stateOf = (referenceName: string): WalletState => {
    const ready = prepared.get(referenceName);
    if (ready?.ready) return { status: "ready", prepared: ready };
    const reason = unavailable.get(referenceName) ?? "not_prepared";
    return reason === "preparing" ? { status: "preparing" } : { status: "unavailable", reason };
  };

  const takePending = (referenceName: string): Pending | undefined => {
    const waiting = pending.get(referenceName);
    pending.delete(referenceName);
    return waiting;
  };

  const markUnavailable = (referenceName: string, reason: string) => {
    prepared.delete(referenceName);
    unavailable.set(referenceName, reason);
    const waiting = takePending(referenceName);
    if (!waiting) return;
    stopLoading();
    waiting.resolve({ status: "unavailable", reason });
  };

  const confirm = async (
    ready: Prepared,
    payload: {
      setupIntentId?: string;
      paymentMethodId?: string;
      stripeCustomerId?: string;
      email?: string;
    },
  ): Promise<ConfirmResponse> => {
    const request = options.fetchWithRetry ?? defaultFetchWithRetry;
    const url = options.confirmUrl?.() ?? subscriptionsApiUrl("checkout/session/confirm");
    const response = await request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.publicApiKey()}`,
        },
        body: JSON.stringify({ checkoutContextId: ready.quote.checkoutContextId, ...payload }),
      },
      { retries: 0 },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessageOf(body, `Checkout confirmation failed (${response.status})`));
    }
    return readConfirmResponse(body);
  };

  const confirmDeferred = async (
    ready: Prepared,
    event: PaymentRequestPaymentMethodEvent,
    email: string | undefined,
    complete: Complete,
  ) => {
    const response = await confirm(ready, {
      paymentMethodId: event.paymentMethod.id,
      stripeCustomerId: ready.identity.stripeCustomerId,
      email,
    });
    recordConfirmation(ready, response);
    complete("success");

    if (!response.requiresAction || !response.clientSecret) return;

    if (response.intentType === "SetupIntent") {
      const result = await ready.stripe.confirmCardSetup(response.clientSecret);
      if (result.error) throw new Error(result.error.message || "Setup authentication failed");
      const setupIntentId = result.setupIntent?.id || response.setupIntentId;
      if (!setupIntentId) throw new Error("No SetupIntent returned");
      recordConfirmation(ready, await confirm(ready, { setupIntentId, email }));
      return;
    }

    const result = await ready.stripe.confirmCardPayment(response.clientSecret, {
      payment_method: event.paymentMethod.id,
    });
    if (result.error) throw new Error(result.error.message || "Payment authentication failed");
  };

  const confirmSetupIntent = async (
    ready: Prepared,
    clientSecret: string,
    event: PaymentRequestPaymentMethodEvent,
    email: string | undefined,
  ) => {
    const first = await ready.stripe.confirmCardSetup(
      clientSecret,
      { payment_method: event.paymentMethod.id },
      { handleActions: false },
    );
    if (first.error) throw new Error(first.error.message || "Setup failed");
    let setupIntent: SetupIntent | undefined = first.setupIntent;
    if (setupIntent?.status === "requires_action") {
      const next = await ready.stripe.confirmCardSetup(clientSecret);
      if (next.error) throw new Error(next.error.message || "Setup authentication failed");
      setupIntent = next.setupIntent;
    }
    if (!setupIntent) throw new Error("No SetupIntent returned");
    recordConfirmation(ready, await confirm(ready, { setupIntentId: setupIntent.id, email }));
  };

  const confirmPaymentIntent = async (
    ready: Prepared,
    clientSecret: string,
    event: PaymentRequestPaymentMethodEvent,
    email: string | undefined,
    complete: Complete,
  ) => {
    const first = await ready.stripe.confirmCardPayment(
      clientSecret,
      { payment_method: event.paymentMethod.id },
      { handleActions: false },
    );
    if (first.error) throw new Error(first.error.message || "Payment failed");
    complete("success");
    let paymentIntent: PaymentIntent | undefined = first.paymentIntent;
    if (paymentIntent?.status === "requires_action") {
      const next = await ready.stripe.confirmCardPayment(clientSecret);
      if (next.error) throw new Error(next.error.message || "Payment authentication failed");
      paymentIntent = next.paymentIntent;
    }
    try {
      recordConfirmation(ready, await confirm(ready, { email }));
    } catch (error) {
      console.error("[Apple Pay] Post-payment confirm failed (non-fatal):", error);
    }
  };

  const onPaymentMethod = async (ready: Prepared, event: PaymentRequestPaymentMethodEvent) => {
    ready.authorized = true;
    checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session: ready.session });
    if (ready.context) options.host.submitted(ready.context);

    let completed = false;
    const complete: Complete = (status) => {
      if (completed) return;
      completed = true;
      try {
        event.complete(status);
      } catch {}
    };

    try {
      const email = event.payerEmail || ready.identity.email;
      if (ready.clientSecret === null) {
        await confirmDeferred(ready, event, email, complete);
      } else if (ready.quote.intentType === "SetupIntent") {
        await confirmSetupIntent(ready, ready.clientSecret, event, email);
        complete("success");
      } else {
        await confirmPaymentIntent(ready, ready.clientSecret, event, email, complete);
      }

      checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: ready.session });
      ready.settle?.({ status: "completed" });
    } catch (error) {
      complete("fail");
      const failure = error instanceof Error ? error : new Error("Apple Pay failed");
      checkoutEvents.dispatch("PAYMENT_ERROR", { error: failure, session: ready.session });
      if (ready.context) options.host.failed(ready.context);
      ready.settle?.({ status: "failed" });
    }
  };

  const onCancel = (ready: Prepared) => {
    if (ready.authorized || !ready.settle) return;
    if (ready.context) options.host.abandoned(ready.context);
    ready.settle({ status: "abandoned" });
  };

  const show = (ready: Prepared, context: HostContext): Promise<ApplePayOutcome> => {
    if (ready.inProgress) return Promise.resolve({ status: "failed" });

    ready.context = context;
    ready.authorized = false;
    ready.inProgress = true;

    try {
      ready.paymentRequest.show();
    } catch {
      ready.inProgress = false;
      markUnavailable(ready.quote.referenceName, "show_failed");
      return Promise.resolve({ status: "unavailable", reason: "show_failed" });
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

    clear: () => {
      prepared.clear();
      unavailable.clear();
      for (const waiting of pending.values()) {
        waiting.resolve({ status: "unavailable", reason: "cleared" });
      }
      pending.clear();
    },

    purchase: (referenceName, context) => {
      const state = stateOf(referenceName);
      if (state.status === "ready") return show(state.prepared, context);
      if (state.status === "unavailable") return Promise.resolve(state);
      startLoading();
      return new Promise((resolve) => {
        pending.set(referenceName, { context, resolve });
      });
    },

    prepare: async (quote, identity = {}) => {
      const { referenceName } = quote;
      prepared.delete(referenceName);
      unavailable.set(referenceName, "preparing");

      if (!options.publicApiKey()) {
        markUnavailable(referenceName, "missing_public_api_key");
        return;
      }

      const loadStripe = options.loadStripe ?? (await import("@stripe/stripe-js")).loadStripe;
      const stripe = await loadStripe(quote.publishableKey, {
        developerTools: { assistant: { enabled: false } },
      });
      if (!stripe) {
        markUnavailable(referenceName, "stripe_js_load_failed");
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
        clientSecret: quote.checkoutSessionId
          ? decodeCheckoutSessionId(quote.checkoutSessionId)
          : null,
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
          markUnavailable(referenceName, "apple_pay_not_available");
          return;
        }
      } catch {
        markUnavailable(referenceName, "can_make_payment_failed");
        return;
      }

      ready.ready = true;
      unavailable.delete(referenceName);
      prepared.set(referenceName, ready);
      const waiting = takePending(referenceName);
      if (waiting) void show(ready, waiting.context).then(waiting.resolve);
    },
  };
};
