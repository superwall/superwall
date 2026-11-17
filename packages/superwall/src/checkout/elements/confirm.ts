import type { SetupIntent, Stripe } from "@stripe/stripe-js";
import { fetchWithRetry as defaultFetchWithRetry } from "../api/fetch";
import {
  errorFailureOf,
  errorMessageOf,
  field,
  intentTypeOf,
  readStripeError,
} from "../api/decode";
import { subscriptionsApiUrl } from "../api/url";
import { CheckoutFailureError, unknownFailure } from "../failure";
import { decodeCheckoutSessionId } from "../session/id";
import type { ElementsCheckoutSession } from "../types";

export type ConfirmationOptions = {
  publicApiKey: () => string;
  fetchWithRetry?: typeof defaultFetchWithRetry;
  confirmUrl?: () => string;
};

export type PaymentToConfirm = {
  name: string;
  stripe: Stripe;
  quote: ElementsCheckoutSession;
  paymentMethodId: string;
  stripeCustomerId?: string;
  email?: string;
  onAuthorized: () => void;
  onSubscription: (subscriptionId: string) => void;
};

export type Confirmation = {
  confirm(payment: PaymentToConfirm): Promise<void>;
};

type ConfirmResponse = {
  subscriptionId?: string;
  requiresAction: boolean;
  clientSecret?: string;
  intentType?: "SetupIntent" | "PaymentIntent";
  setupIntentId?: string;
};

type ConfirmPayload = {
  setupIntentId?: string;
  paymentMethodId?: string;
  stripeCustomerId?: string;
  email?: string;
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

const stripeDecline = (error: unknown, fallback: string): CheckoutFailureError =>
  new CheckoutFailureError(readStripeError(error), fallback);

export const createConfirmation = (options: ConfirmationOptions): Confirmation => {
  const post = async (payment: PaymentToConfirm, payload: ConfirmPayload) => {
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
        body: JSON.stringify({ checkoutContextId: payment.quote.checkoutContextId, ...payload }),
      },
      { retries: 0, returnClientErrors: true },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = errorMessageOf(body, `Checkout confirmation failed (${response.status})`);
      throw new CheckoutFailureError(errorFailureOf(body) ?? unknownFailure(), message);
    }
    const confirmed = readConfirmResponse(body);
    if (confirmed.subscriptionId) payment.onSubscription(confirmed.subscriptionId);
    return confirmed;
  };

  const confirmDeferred = async (payment: PaymentToConfirm) => {
    const { stripe, paymentMethodId, email } = payment;
    const response = await post(payment, {
      paymentMethodId,
      stripeCustomerId: payment.stripeCustomerId,
      email,
    });
    payment.onAuthorized();

    if (!response.requiresAction || !response.clientSecret) return;

    if (response.intentType === "SetupIntent") {
      const result = await stripe.confirmCardSetup(response.clientSecret);
      if (result.error) throw stripeDecline(result.error, "Setup authentication failed");
      const setupIntentId = result.setupIntent?.id || response.setupIntentId;
      if (!setupIntentId) throw new Error("No SetupIntent returned");
      await post(payment, { setupIntentId, email });
      return;
    }

    const result = await stripe.confirmCardPayment(response.clientSecret, {
      payment_method: paymentMethodId,
    });
    if (result.error) throw stripeDecline(result.error, "Payment authentication failed");
  };

  const confirmSetupIntent = async (payment: PaymentToConfirm, clientSecret: string) => {
    const { stripe, paymentMethodId, email } = payment;
    const first = await stripe.confirmCardSetup(
      clientSecret,
      { payment_method: paymentMethodId },
      { handleActions: false },
    );
    if (first.error) throw stripeDecline(first.error, "Setup failed");
    let setupIntent: SetupIntent | undefined = first.setupIntent;
    if (setupIntent?.status === "requires_action") {
      const next = await stripe.confirmCardSetup(clientSecret);
      if (next.error) throw stripeDecline(next.error, "Setup authentication failed");
      setupIntent = next.setupIntent;
    }
    if (!setupIntent) throw new Error("No SetupIntent returned");
    await post(payment, { setupIntentId: setupIntent.id, email });
    payment.onAuthorized();
  };

  const confirmPaymentIntent = async (payment: PaymentToConfirm, clientSecret: string) => {
    const { stripe, paymentMethodId, email } = payment;
    const first = await stripe.confirmCardPayment(
      clientSecret,
      { payment_method: paymentMethodId },
      { handleActions: false },
    );
    if (first.error) throw stripeDecline(first.error, "Payment failed");
    payment.onAuthorized();
    if (first.paymentIntent?.status === "requires_action") {
      const next = await stripe.confirmCardPayment(clientSecret);
      if (next.error) throw stripeDecline(next.error, "Payment authentication failed");
    }
    try {
      await post(payment, { email });
    } catch (error) {
      console.error(`[${payment.name}] Post-payment confirm failed (non-fatal):`, error);
    }
  };

  return {
    confirm: (payment) => {
      const { checkoutSessionId, intentType } = payment.quote;
      const clientSecret = checkoutSessionId ? decodeCheckoutSessionId(checkoutSessionId) : null;
      if (clientSecret === null) return confirmDeferred(payment);
      return intentType === "SetupIntent"
        ? confirmSetupIntent(payment, clientSecret)
        : confirmPaymentIntent(payment, clientSecret);
    },
  };
};
