import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplePayCheckoutController } from "../../src/checkout/services/ApplePayCheckoutController";
import { checkoutHostEvents } from "../../src/checkout/services/hostEvents";
import { checkoutEvents } from "../../src/checkout/services/CheckoutEvents";
import { isLoading } from "../../src/checkout/services/loading";
import {
  buildCheckoutSessionId,
  decodeCheckoutSessionId,
} from "../../src/checkout/utils/checkoutSessionId";
import type { ElementsCheckoutSession } from "../../src/checkout/state/types";

const quote = (overrides: Partial<ElementsCheckoutSession> = {}): ElementsCheckoutSession => ({
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test_123",
  checkoutContextId: "ctx_123",
  referenceName: "primary",
  subscriptionDetails: {
    amount: 1000,
    amountDueNow: 1000,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    productName: "Premium",
  },
  intentType: "PaymentIntent",
  stripeAccountCountryCode: "US",
  ...overrides,
});

const context = {
  checkoutContextId: "ctx_123",
  productIdentifier: "test:price_1:no-trial",
  paywallIdentifier: "paywall",
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeController = ({
  canMakePayment = { applePay: true } as Record<string, boolean> | null,
  confirmCardPayment = { paymentIntent: { id: "pi_1", status: "succeeded" } } as unknown,
  confirmCardSetup = { setupIntent: { id: "seti_1", status: "succeeded" } } as unknown,
  confirmResponse = { customerId: "cus_1", subscriptionId: "sub_1" } as Record<string, unknown>,
  confirmStatus = 200,
} = {}) => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const paymentRequest = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
      return paymentRequest;
    }),
    canMakePayment: vi.fn().mockResolvedValue(canMakePayment),
    show: vi.fn(),
  };
  const stripe = {
    paymentRequest: vi.fn(() => paymentRequest),
    confirmCardPayment: vi.fn().mockResolvedValue(confirmCardPayment),
    confirmCardSetup: vi.fn().mockResolvedValue(confirmCardSetup),
  };
  const post = vi.fn();
  const fetchWithRetry = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(confirmResponse), { status: confirmStatus }));
  const controller = new ApplePayCheckoutController({
    publicApiKey: () => "pk_public",
    host: checkoutHostEvents(post),
    loadStripe: vi.fn().mockResolvedValue(stripe) as never,
    fetchWithRetry,
    confirmUrl: () => "https://subscriptions.test/confirm",
  });
  const authorize = (event: Partial<{ payerEmail: string }> = {}) =>
    handlers.get("paymentmethod")!({
      paymentMethod: { id: "pm_1" },
      complete: vi.fn(),
      ...event,
    });
  const cancel = () => handlers.get("cancel")!();
  const posted = (name: string) =>
    post.mock.calls.map(([message]) => message).filter((m) => m.event_name === name);

  return { controller, stripe, paymentRequest, fetchWithRetry, authorize, cancel, posted, post };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApplePayCheckoutController", () => {
  it("prepares the wallet from a quote and opens it on purchase", async () => {
    const { controller, paymentRequest, posted, authorize } = makeController();
    await controller.prepare(quote());
    expect(controller.availability("primary")).toEqual({ status: "ready" });

    const outcome = controller.purchase("primary", context);
    expect(paymentRequest.show).toHaveBeenCalledOnce();
    expect(isLoading()).toBe(true);
    expect(posted("initiate_web_checkout")).toHaveLength(1);
    expect(posted("stripe_checkout_start")).toHaveLength(1);

    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(isLoading()).toBe(false);
  });

  it("builds the request from the quote: total, billing, and line items", async () => {
    const { controller, stripe } = makeController();
    await controller.prepare(
      quote({
        managementUrl: "https://example.superwall.app/manage",
        subscriptionDetails: {
          amount: 2000,
          amountDueNow: 1500,
          currency: "usd",
          interval: "month",
          intervalCount: 1,
          productName: "Premium",
          discountedAmount: 1500,
          discount: { code: "SAVE5", promotionCodeId: "promo", couponId: "c", duration: "once" },
        },
      }),
    );

    expect(stripe.paymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        country: "US",
        currency: "usd",
        total: { label: "Premium", amount: 1500 },
        displayItems: [
          { label: "Premium", amount: 2000 },
          { label: "Code SAVE5", amount: -500 },
        ],
        applePay: {
          recurringPaymentRequest: expect.objectContaining({
            managementURL: "https://example.superwall.app/manage",
            regularBilling: expect.objectContaining({ amount: 2000 }),
          }),
        },
      }),
    );
  });

  it("charges nothing up front on a free trial and quotes the trial line", async () => {
    const { controller, stripe } = makeController();
    await controller.prepare(
      quote({
        intentType: "SetupIntent",
        subscriptionDetails: {
          amount: 2000,
          amountDueNow: 0,
          currency: "usd",
          interval: "month",
          intervalCount: 1,
          trialPeriodDays: 7,
          productName: "Premium",
        },
      }),
    );
    expect(stripe.paymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        total: { label: "Premium", amount: 0 },
        applePay: {
          recurringPaymentRequest: expect.objectContaining({
            trialBilling: expect.objectContaining({ label: "7-Day Free Trial", amount: 0 }),
          }),
        },
      }),
    );
  });

  it("reports unavailable when the device cannot pay, so the caller can fall back", async () => {
    const { controller, paymentRequest } = makeController({ canMakePayment: null });
    await controller.prepare(quote());
    await expect(controller.purchase("primary", context)).resolves.toEqual({
      status: "unavailable",
      reason: "apple_pay_not_available",
    });
    expect(paymentRequest.show).not.toHaveBeenCalled();
  });

  it("is unavailable for a product that was never prepared", async () => {
    const { controller } = makeController();
    await expect(controller.purchase("primary", context)).resolves.toEqual({
      status: "unavailable",
      reason: "not_prepared",
    });
  });

  it("waits for a preparation in flight, then opens the wallet", async () => {
    const { controller, paymentRequest, authorize } = makeController();
    const preparing = controller.prepare(quote());
    expect(controller.availability("primary")).toEqual({ status: "preparing" });

    const outcome = controller.purchase("primary", context);
    expect(isLoading()).toBe(true);
    expect(paymentRequest.show).not.toHaveBeenCalled();

    await preparing;
    expect(paymentRequest.show).toHaveBeenCalledOnce();
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
  });

  it("settles a waiting purchase as unavailable when preparation fails", async () => {
    const { controller } = makeController({ canMakePayment: { applePay: false } });
    const preparing = controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await preparing;
    await expect(outcome).resolves.toEqual({
      status: "unavailable",
      reason: "apple_pay_not_available",
    });
    expect(isLoading()).toBe(false);
  });

  it("settles a waiting purchase when the quotes are cleared", async () => {
    const { controller } = makeController();
    void controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    controller.clear();
    await expect(outcome).resolves.toEqual({ status: "unavailable", reason: "cleared" });
  });

  it("reports abandoned when the sheet closes before authorization", async () => {
    const { controller, cancel, posted } = makeController();
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    cancel();
    await expect(outcome).resolves.toEqual({ status: "abandoned" });
    expect(posted("stripe_checkout_abandon")).toHaveLength(1);
    expect(isLoading()).toBe(false);
  });

  it("ignores the close Apple sends after authorization", async () => {
    const { controller, cancel, authorize, posted } = makeController();
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    const authorizing = authorize();
    cancel();
    await authorizing;
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(posted("stripe_checkout_abandon")).toHaveLength(0);
  });

  it("confirms a deferred quote on the backend and reports the subscription to the host", async () => {
    const { controller, fetchWithRetry, authorize, posted } = makeController();
    const success = vi.fn();
    const off = checkoutEvents.subscribe("PAYMENT_SUCCESS", success);
    await controller.prepare(quote(), { email: "shopper@example.com", stripeCustomerId: "cus_x" });
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    off();

    expect(fetchWithRetry).toHaveBeenCalledWith(
      "https://subscriptions.test/confirm",
      expect.objectContaining({
        body: JSON.stringify({
          checkoutContextId: "ctx_123",
          paymentMethodId: "pm_1",
          stripeCustomerId: "cus_x",
          email: "shopper@example.com",
        }),
      }),
      { retries: 0 },
    );
    expect(posted("stripe_checkout_submit")).toHaveLength(1);
    const [complete] = posted("stripe_checkout_complete");
    expect(complete).toMatchObject({
      checkout_context_id: "ctx_123",
      product_identifier: "test:price_1:no-trial",
    });
    expect(decodeCheckoutSessionId(complete.sw_checkout_id)).toBe("sub_1");
    expect(success).toHaveBeenCalledWith({
      session: expect.objectContaining({ directive: "applePay", referenceName: "primary" }),
    });
  });

  it("prefers the wallet's payer email over the paywall's", async () => {
    const { controller, fetchWithRetry, authorize } = makeController();
    await controller.prepare(quote(), { email: "paywall@example.com" });
    const outcome = controller.purchase("primary", context);
    await authorize({ payerEmail: "wallet@example.com" });
    await outcome;
    expect(JSON.parse(fetchWithRetry.mock.calls[0]![1].body as string).email).toBe(
      "wallet@example.com",
    );
  });

  it("completes 3DS on the client when the backend asks for it", async () => {
    const { controller, stripe, authorize } = makeController({
      confirmResponse: {
        requiresAction: true,
        clientSecret: "pi_secret",
        intentType: "PaymentIntent",
        subscriptionId: "sub_1",
      },
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(stripe.confirmCardPayment).toHaveBeenCalledWith("pi_secret", {
      payment_method: "pm_1",
    });
  });

  it("confirms a quote that already carries a SetupIntent on the client first", async () => {
    const { controller, stripe, fetchWithRetry, authorize } = makeController();
    await controller.prepare(
      quote({
        intentType: "SetupIntent",
        checkoutSessionId: buildCheckoutSessionId({
          stripeCheckoutSessionId: "seti_secret",
          environment: "test",
        }),
      }),
    );
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(stripe.confirmCardSetup).toHaveBeenCalledWith(
      "seti_secret",
      { payment_method: "pm_1" },
      { handleActions: false },
    );
    expect(JSON.parse(fetchWithRetry.mock.calls[0]![1].body as string)).toMatchObject({
      setupIntentId: "seti_1",
    });
  });

  it("fails the purchase, and tells the host, when the backend refuses", async () => {
    const { controller, authorize, posted } = makeController({
      confirmResponse: { title: "Promotion Code No Longer Applies" },
      confirmStatus: 409,
    });
    const failure = vi.fn();
    const off = checkoutEvents.subscribe("PAYMENT_ERROR", failure);
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "failed" });
    off();
    expect(posted("stripe_checkout_fail")).toHaveLength(1);
    expect(posted("stripe_checkout_complete")).toHaveLength(0);
    expect(failure.mock.calls[0]![0].error.message).toBe("Promotion Code No Longer Applies");
    await flush();
    expect(isLoading()).toBe(false);
  });

  it("marks the product unavailable when the wallet refuses to open", async () => {
    const { controller, paymentRequest } = makeController();
    await controller.prepare(quote());
    paymentRequest.show.mockImplementation(() => {
      throw new Error("not allowed");
    });
    await expect(controller.purchase("primary", context)).resolves.toEqual({
      status: "unavailable",
      reason: "show_failed",
    });
    expect(controller.availability("primary")).toEqual({
      status: "unavailable",
      reason: "show_failed",
    });
  });
});
