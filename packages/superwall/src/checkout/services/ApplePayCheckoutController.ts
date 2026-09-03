import type {
  loadStripe as loadStripeFn,
  PaymentIntent,
  PaymentRequest,
  PaymentRequestPaymentMethodEvent,
  SetupIntent,
  Stripe,
} from "@stripe/stripe-js";
import { fetchWithRetry as defaultFetchWithRetry, subscriptionsApiUrl } from "./api";
import { checkoutEvents } from "./CheckoutEvents";
import { startLoading, stopLoading } from "./loading";
import type { CheckoutHostContext, CheckoutHostEvents } from "./hostEvents";
import { buildApplePayConfig, buildApplePayLineItems } from "../utils/applePay";
import {
  buildCheckoutSessionId,
  decodeCheckoutSessionId,
  stripeEnvironmentOf,
} from "../utils/checkoutSessionId";
import type { ApplePaySessionData, ElementsCheckoutSession } from "../state/types";

/** How an Apple Pay purchase ended, or why the sheet could not open. */
export type ApplePayOutcome =
  | { status: "completed" | "abandoned" | "failed" }
  | { status: "unavailable"; reason: string };

/** Whether the wallet can open for a product right now. */
export type ApplePayAvailability =
  | { status: "preparing" }
  | { status: "ready" }
  | { status: "unavailable"; reason: string };

export type ApplePayIdentity = {
  email?: string;
  stripeCustomerId?: string;
};

type ConfirmResponse = {
  customerId?: string;
  subscriptionId?: string;
  requiresAction?: boolean;
  clientSecret?: string;
  intentType?: "SetupIntent" | "PaymentIntent";
  setupIntentId?: string;
};

type PreparedSession = {
  session: ElementsCheckoutSession;
  identity: ApplePayIdentity;
  stripe: Stripe;
  paymentRequest: PaymentRequest;
  clientSecret: string | null;
  data: ApplePaySessionData;
  context: CheckoutHostContext | null;
  ready: boolean;
  inProgress: boolean;
  authorized: boolean;
  settle: ((outcome: ApplePayOutcome) => void) | null;
};

type PendingPurchase = {
  context: CheckoutHostContext;
  resolve: (outcome: ApplePayOutcome) => void;
};

export type ApplePayCheckoutControllerOptions = {
  publicApiKey: () => string;
  host: CheckoutHostEvents;
  loadStripe?: typeof loadStripeFn;
  fetchWithRetry?: typeof defaultFetchWithRetry;
  confirmUrl?: () => string;
};

const errorMessageOf = (body: unknown, fallback: string): string => {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    for (const key of ["message", "detail", "title"] as const) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return fallback;
};

const totalAmountOf = (session: ElementsCheckoutSession): number => {
  const { amountDueNow, amount } = session.subscriptionDetails;
  if (typeof amountDueNow === "number") return amountDueNow;
  return session.intentType === "SetupIntent" ? 0 : amount;
};

const defaultManagementUrl = (): string =>
  typeof window === "undefined" ? "/manage" : new URL("/manage", window.location.origin).toString();

/**
 * Apple Pay through Stripe's PaymentRequest, opened straight from the paywall.
 *
 * A product is *prepared* from its `elements` quote as soon as the paywall
 * prefetches it: Stripe.js loads, the request is built with the quote's
 * recurring/trial billing and line items, and `canMakePayment` decides
 * whether the wallet can open. A purchase then shows the native sheet at
 * once, waits for a preparation still in flight, or reports `unavailable`
 * so the caller can fall back to the embedded sheet. The wallet's
 * authorization is turned into a subscription by the backend's confirm
 * endpoint (deferred quotes) or by confirming the quote's intent on the
 * client.
 */
export class ApplePayCheckoutController {
  private prepared = new Map<string, PreparedSession>();
  private unavailable = new Map<string, string>();
  private pending = new Map<string, PendingPurchase>();

  constructor(private readonly options: ApplePayCheckoutControllerOptions) {}

  clear() {
    this.prepared.clear();
    this.unavailable.clear();
    for (const pending of this.pending.values()) {
      pending.resolve({ status: "unavailable", reason: "cleared" });
    }
    this.pending.clear();
  }

  availability(referenceName: string): ApplePayAvailability {
    if (this.prepared.get(referenceName)?.ready) return { status: "ready" };
    const reason = this.unavailable.get(referenceName);
    if (reason === undefined) return { status: "unavailable", reason: "not_prepared" };
    if (reason === "preparing") return { status: "preparing" };
    return { status: "unavailable", reason };
  }

  markUnavailable(referenceName: string, reason: string) {
    this.prepared.delete(referenceName);
    this.unavailable.set(referenceName, reason);
    this.settlePending(referenceName);
  }

  async prepare(session: ElementsCheckoutSession, identity: ApplePayIdentity = {}) {
    const { referenceName } = session;
    this.prepared.delete(referenceName);
    this.unavailable.set(referenceName, "preparing");

    const publicApiKey = this.options.publicApiKey();
    if (!publicApiKey) {
      this.markUnavailable(referenceName, "missing_public_api_key");
      return;
    }

    const loadStripe = this.options.loadStripe ?? (await import("@stripe/stripe-js")).loadStripe;
    const stripe = await loadStripe(session.publishableKey, {
      developerTools: { assistant: { enabled: false } },
    });
    if (!stripe) {
      this.markUnavailable(referenceName, "stripe_js_load_failed");
      return;
    }

    const details = session.subscriptionDetails;
    const displayItems = buildApplePayLineItems(details);
    const paymentRequest = stripe.paymentRequest({
      country: (session.stripeAccountCountryCode || "US").toUpperCase(),
      currency: details.currency.toLowerCase(),
      total: { label: details.productName || "Subscribe", amount: totalAmountOf(session) },
      ...(displayItems ? { displayItems } : {}),
      requestPayerName: true,
      requestPayerEmail: true,
      disableWallets: ["googlePay", "link", "browserCard"],
      applePay: buildApplePayConfig(details, session.managementUrl || defaultManagementUrl()),
    });

    const prepared: PreparedSession = {
      session,
      identity,
      stripe,
      paymentRequest,
      clientSecret: session.checkoutSessionId
        ? decodeCheckoutSessionId(session.checkoutSessionId)
        : null,
      data: {
        directive: "applePay",
        referenceName,
        checkoutContextId: session.checkoutContextId,
        checkoutSessionId: null,
      },
      context: null,
      ready: false,
      inProgress: false,
      authorized: false,
      settle: null,
    };

    paymentRequest.on("paymentmethod", (event) => void this.onPaymentMethod(prepared, event));
    paymentRequest.on("cancel", () => this.onCancel(prepared));

    try {
      const canMakePayment = await paymentRequest.canMakePayment();
      if (canMakePayment?.applePay !== true) {
        this.markUnavailable(referenceName, "apple_pay_not_available");
        return;
      }
    } catch {
      this.markUnavailable(referenceName, "can_make_payment_failed");
      return;
    }

    prepared.ready = true;
    this.unavailable.delete(referenceName);
    this.prepared.set(referenceName, prepared);
    this.settlePending(referenceName);
  }

  purchase(referenceName: string, context: CheckoutHostContext): Promise<ApplePayOutcome> {
    const availability = this.availability(referenceName);
    if (availability.status === "ready") {
      return this.show(referenceName, context);
    }
    if (availability.status === "unavailable") {
      return Promise.resolve(availability);
    }
    startLoading();
    return new Promise((resolve) => {
      this.pending.set(referenceName, { context, resolve });
    });
  }

  private settlePending(referenceName: string) {
    const pending = this.pending.get(referenceName);
    if (!pending) return;
    this.pending.delete(referenceName);
    const availability = this.availability(referenceName);
    if (availability.status === "ready") {
      void this.show(referenceName, pending.context).then(pending.resolve);
      return;
    }
    stopLoading();
    pending.resolve(
      availability.status === "unavailable"
        ? availability
        : { status: "unavailable", reason: "not_ready" },
    );
  }

  private show(referenceName: string, context: CheckoutHostContext): Promise<ApplePayOutcome> {
    const prepared = this.prepared.get(referenceName);
    if (!prepared?.ready) {
      return Promise.resolve({ status: "unavailable", reason: "not_ready" });
    }
    if (prepared.inProgress) {
      return Promise.resolve({ status: "failed" });
    }

    prepared.context = context;
    prepared.authorized = false;
    prepared.inProgress = true;

    try {
      prepared.paymentRequest.show();
    } catch {
      prepared.inProgress = false;
      this.markUnavailable(referenceName, "show_failed");
      return Promise.resolve({ status: "unavailable", reason: "show_failed" });
    }

    startLoading();
    this.options.host.initiated(context);

    return new Promise((resolve) => {
      prepared.settle = (outcome) => {
        prepared.settle = null;
        prepared.inProgress = false;
        stopLoading();
        resolve(outcome);
      };
    });
  }

  private onCancel(prepared: PreparedSession) {
    if (prepared.authorized || !prepared.settle) return;
    if (prepared.context) this.options.host.abandoned(prepared.context);
    prepared.settle({ status: "abandoned" });
  }

  private async onPaymentMethod(
    prepared: PreparedSession,
    event: PaymentRequestPaymentMethodEvent,
  ) {
    prepared.authorized = true;
    checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session: prepared.data });
    if (prepared.context) this.options.host.submitted(prepared.context);

    let completed = false;
    const complete = (status: "success" | "fail") => {
      if (completed) return;
      completed = true;
      try {
        event.complete(status);
      } catch {}
    };

    try {
      const email = event.payerEmail || prepared.identity.email;
      if (prepared.clientSecret === null) {
        await this.confirmDeferred(prepared, event, email, complete);
      } else if (prepared.session.intentType === "SetupIntent") {
        await this.confirmSetupIntent(prepared, event, email);
        complete("success");
      } else {
        await this.confirmPaymentIntent(prepared, event, email, complete);
      }

      checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: prepared.data });
      if (prepared.context) {
        this.options.host.completed(prepared.context, prepared.data.checkoutSessionId);
      }
      prepared.settle?.({ status: "completed" });
    } catch (error) {
      complete("fail");
      const failure = error instanceof Error ? error : new Error("Apple Pay failed");
      checkoutEvents.dispatch("PAYMENT_ERROR", { error: failure, session: prepared.data });
      if (prepared.context) this.options.host.failed(prepared.context);
      prepared.settle?.({ status: "failed" });
    }
  }

  private async confirmDeferred(
    prepared: PreparedSession,
    event: PaymentRequestPaymentMethodEvent,
    email: string | undefined,
    complete: (status: "success" | "fail") => void,
  ) {
    const response = await this.confirm(prepared, {
      paymentMethodId: event.paymentMethod.id,
      stripeCustomerId: prepared.identity.stripeCustomerId,
      email,
    });
    this.recordConfirmation(prepared, response);
    complete("success");

    if (!response.requiresAction || !response.clientSecret) return;

    if (response.intentType === "SetupIntent") {
      const result = await prepared.stripe.confirmCardSetup(response.clientSecret);
      if (result.error) throw new Error(result.error.message || "Setup authentication failed");
      const setupIntentId = result.setupIntent?.id || response.setupIntentId;
      if (!setupIntentId) throw new Error("No SetupIntent returned");
      this.recordConfirmation(prepared, await this.confirm(prepared, { setupIntentId, email }));
      return;
    }

    const result = await prepared.stripe.confirmCardPayment(response.clientSecret, {
      payment_method: event.paymentMethod.id,
    });
    if (result.error) throw new Error(result.error.message || "Payment authentication failed");
  }

  private async confirmSetupIntent(
    prepared: PreparedSession,
    event: PaymentRequestPaymentMethodEvent,
    email: string | undefined,
  ) {
    const clientSecret = prepared.clientSecret as string;
    const first = await prepared.stripe.confirmCardSetup(
      clientSecret,
      { payment_method: event.paymentMethod.id },
      { handleActions: false },
    );
    if (first.error) throw new Error(first.error.message || "Setup failed");
    let setupIntent: SetupIntent | undefined = first.setupIntent;
    if (setupIntent?.status === "requires_action") {
      const next = await prepared.stripe.confirmCardSetup(clientSecret);
      if (next.error) throw new Error(next.error.message || "Setup authentication failed");
      setupIntent = next.setupIntent;
    }
    if (!setupIntent) throw new Error("No SetupIntent returned");
    this.recordConfirmation(
      prepared,
      await this.confirm(prepared, { setupIntentId: setupIntent.id, email }),
    );
  }

  private async confirmPaymentIntent(
    prepared: PreparedSession,
    event: PaymentRequestPaymentMethodEvent,
    email: string | undefined,
    complete: (status: "success" | "fail") => void,
  ) {
    const clientSecret = prepared.clientSecret as string;
    const first = await prepared.stripe.confirmCardPayment(
      clientSecret,
      { payment_method: event.paymentMethod.id },
      { handleActions: false },
    );
    if (first.error) throw new Error(first.error.message || "Payment failed");
    complete("success");
    let paymentIntent: PaymentIntent | undefined = first.paymentIntent;
    if (paymentIntent?.status === "requires_action") {
      const next = await prepared.stripe.confirmCardPayment(clientSecret);
      if (next.error) throw new Error(next.error.message || "Payment authentication failed");
      paymentIntent = next.paymentIntent;
    }
    try {
      this.recordConfirmation(prepared, await this.confirm(prepared, { email }));
    } catch (error) {
      console.error("[Apple Pay] Post-payment confirm failed (non-fatal):", error);
    }
  }

  private async confirm(
    prepared: PreparedSession,
    payload: {
      setupIntentId?: string;
      paymentMethodId?: string;
      stripeCustomerId?: string;
      email?: string;
    },
  ): Promise<ConfirmResponse> {
    const fetchWithRetry = this.options.fetchWithRetry ?? defaultFetchWithRetry;
    const url = this.options.confirmUrl?.() ?? subscriptionsApiUrl("checkout/session/confirm");
    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.publicApiKey()}`,
        },
        body: JSON.stringify({
          checkoutContextId: prepared.session.checkoutContextId,
          ...payload,
        }),
      },
      { retries: 0 },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessageOf(body, `Checkout confirmation failed (${response.status})`));
    }
    return body as ConfirmResponse;
  }

  private recordConfirmation(prepared: PreparedSession, response: ConfirmResponse) {
    if (!response.subscriptionId || prepared.data.checkoutSessionId) return;
    prepared.data.checkoutSessionId = buildCheckoutSessionId({
      stripeCheckoutSessionId: response.subscriptionId,
      environment: stripeEnvironmentOf(prepared.context?.productIdentifier),
    });
  }
}
