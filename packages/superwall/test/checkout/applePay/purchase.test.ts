import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplePay } from "../../../src/checkout/applePay";
import { hostEvents } from "../../../src/checkout/host";
import { checkoutEvents } from "../../../src/checkout/events";
import { isLoading } from "../../../src/checkout/loading";
import { buildCheckoutSessionId, decodeCheckoutSessionId } from "../../../src/checkout/session/id";
import type { ApplePaySession, ElementsCheckoutSession } from "../../../src/checkout/types";

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

let lastCompleted: ApplePaySession | undefined;
checkoutEvents.subscribe("PAYMENT_SUCCESS", ({ session }) => {
  if (session.directive === "applePay") lastCompleted = session;
});

/** The wallet session the last completion carried. */
const completedSession = (): ApplePaySession => {
  if (!lastCompleted) throw new Error("the wallet dispatched no completion");
  return lastCompleted;
};

type BillingLine = { label: string; amount: number };

type PaymentRequestOptions = {
  country: string;
  currency: string;
  total: BillingLine;
  displayItems?: BillingLine[];
  applePay: {
    recurringPaymentRequest: {
      paymentDescription: string;
      managementURL: string;
      trialBilling?: BillingLine;
      regularBilling: BillingLine;
    };
  };
};

const makeController = ({
  stripeLoads = true,
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
    paymentRequest: vi.fn((_options: PaymentRequestOptions) => paymentRequest),
    confirmCardPayment: vi.fn().mockResolvedValue(confirmCardPayment),
    confirmCardSetup: vi.fn().mockResolvedValue(confirmCardSetup),
  };
  const post = vi.fn();
  const fetchWithRetry = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(confirmResponse), { status: confirmStatus }));
  const controller = createApplePay({
    publicApiKey: () => "pk_public",
    host: hostEvents(post),
    loadStripe: vi.fn().mockResolvedValue(stripeLoads ? stripe : null) as never,
    fetchWithRetry,
    confirmUrl: () => "https://subscriptions.test/confirm",
  });
  const authorize = (event: Partial<{ payerEmail: string; complete: () => void }> = {}) =>
    handlers.get("paymentmethod")!({
      paymentMethod: { id: "pm_1" },
      complete: vi.fn(),
      ...event,
    });
  const cancel = () => handlers.get("cancel")!();
  const posted = (name: string) =>
    post.mock.calls.map(([message]) => message).filter((m) => m.event_name === name);
  const requested = (): PaymentRequestOptions => {
    const [options] = stripe.paymentRequest.mock.calls[0] ?? [];
    if (!options) throw new Error("the wallet was never asked for a payment request");
    return options;
  };

  return {
    controller,
    stripe,
    paymentRequest,
    fetchWithRetry,
    authorize,
    cancel,
    posted,
    post,
    requested,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createApplePay", () => {
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
    // Reporting the completion is the flow's job; the wallet says it happened
    // and hands over the session it happened on.
    expect(posted("stripe_checkout_complete")).toHaveLength(0);
    const [{ session }] = success.mock.calls[0] as [{ session: ApplePaySession }];
    expect(session).toMatchObject({ directive: "applePay", referenceName: "primary" });
    expect(decodeCheckoutSessionId(String(session.checkoutSessionId))).toBe("sub_1");
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

describe("createApplePay preparation failures", () => {
  it("is unavailable when Stripe.js will not load", async () => {
    const { controller } = makeController({ stripeLoads: false });
    await controller.prepare(quote());
    expect(controller.availability("primary")).toEqual({
      status: "unavailable",
      reason: "stripe_js_load_failed",
    });
  });

  it("is unavailable when Stripe cannot say whether the device can pay", async () => {
    const { controller, paymentRequest } = makeController();
    paymentRequest.canMakePayment.mockRejectedValue(new Error("blocked"));
    await controller.prepare(quote());
    expect(controller.availability("primary")).toEqual({
      status: "unavailable",
      reason: "can_make_payment_failed",
    });
  });

  it("refuses a second purchase while the sheet is already up", async () => {
    const { controller, authorize } = makeController();
    await controller.prepare(quote());
    const first = controller.purchase("primary", context);
    await expect(controller.purchase("primary", context)).resolves.toEqual({ status: "failed" });
    await authorize();
    await expect(first).resolves.toEqual({ status: "completed" });
  });
});

describe("createApplePay client-side confirmation", () => {
  const withSecret = (intentType: "SetupIntent" | "PaymentIntent") =>
    quote({
      intentType,
      checkoutSessionId: buildCheckoutSessionId({
        stripeCheckoutSessionId: "secret_1",
        environment: "test",
      }),
    });

  it("confirms a PaymentIntent the quote already carries, then records the subscription", async () => {
    const { controller, stripe, fetchWithRetry, authorize } = makeController();
    await controller.prepare(withSecret("PaymentIntent"));
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });

    expect(stripe.confirmCardPayment).toHaveBeenCalledWith(
      "secret_1",
      { payment_method: "pm_1" },
      { handleActions: false },
    );
    expect(JSON.parse(fetchWithRetry.mock.calls[0]![1].body as string)).toEqual({
      checkoutContextId: "ctx_123",
      email: undefined,
    });
    expect(decodeCheckoutSessionId(String(completedSession().checkoutSessionId))).toBe("sub_1");
  });

  it("handles 3DS on a PaymentIntent the quote carries", async () => {
    const { controller, stripe, authorize } = makeController({
      confirmCardPayment: { paymentIntent: { id: "pi_1", status: "requires_action" } },
    });
    await controller.prepare(withSecret("PaymentIntent"));
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(stripe.confirmCardPayment).toHaveBeenCalledTimes(2);
  });

  it("fails when Stripe refuses the payment or its authentication", async () => {
    const refused = makeController({ confirmCardPayment: { error: { message: "declined" } } });
    await refused.controller.prepare(withSecret("PaymentIntent"));
    const first = refused.controller.purchase("primary", context);
    await refused.authorize();
    await expect(first).resolves.toEqual({ status: "failed" });

    const stripe = makeController({
      confirmCardPayment: { paymentIntent: { id: "pi_1", status: "requires_action" } },
    });
    stripe.stripe.confirmCardPayment
      .mockResolvedValueOnce({ paymentIntent: { id: "pi_1", status: "requires_action" } })
      .mockResolvedValueOnce({ error: {} });
    await stripe.controller.prepare(withSecret("PaymentIntent"));
    const second = stripe.controller.purchase("primary", context);
    await stripe.authorize();
    await expect(second).resolves.toEqual({ status: "failed" });
  });

  it("keeps a completed payment when the follow-up confirm fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { controller, fetchWithRetry, authorize } = makeController();
    fetchWithRetry.mockRejectedValue(new Error("offline"));
    await controller.prepare(withSecret("PaymentIntent"));
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(error).toHaveBeenCalledWith(
      "[Apple Pay] Post-payment confirm failed (non-fatal):",
      expect.any(Error),
    );
  });

  it("handles 3DS on a SetupIntent the quote carries, and fails when it is refused", async () => {
    const { controller, stripe, authorize } = makeController({
      confirmCardSetup: { setupIntent: { id: "seti_1", status: "requires_action" } },
    });
    await controller.prepare(withSecret("SetupIntent"));
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(stripe.confirmCardSetup).toHaveBeenCalledTimes(2);

    const refused = makeController({ confirmCardSetup: { error: {} } });
    await refused.controller.prepare(withSecret("SetupIntent"));
    const second = refused.controller.purchase("primary", context);
    await refused.authorize();
    await expect(second).resolves.toEqual({ status: "failed" });
  });

  it("fails a SetupIntent that authenticates into nothing", async () => {
    const { controller, stripe, authorize } = makeController({
      confirmCardSetup: { setupIntent: { id: "seti_1", status: "requires_action" } },
    });
    stripe.confirmCardSetup
      .mockResolvedValueOnce({ setupIntent: { id: "seti_1", status: "requires_action" } })
      .mockResolvedValueOnce({});
    await controller.prepare(withSecret("SetupIntent"));
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "failed" });
  });
});

describe("createApplePay deferred authentication", () => {
  it("authenticates a deferred SetupIntent, then confirms it by id", async () => {
    const { controller, stripe, fetchWithRetry, authorize } = makeController({
      confirmResponse: {
        requiresAction: true,
        clientSecret: "seti_secret",
        intentType: "SetupIntent",
      },
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });

    expect(stripe.confirmCardSetup).toHaveBeenCalledWith("seti_secret");
    expect(JSON.parse(fetchWithRetry.mock.calls[1]![1].body as string)).toMatchObject({
      setupIntentId: "seti_1",
    });
  });

  it("falls back to the id the backend named when Stripe returns no intent", async () => {
    const { controller, fetchWithRetry, authorize } = makeController({
      confirmResponse: {
        requiresAction: true,
        clientSecret: "seti_secret",
        intentType: "SetupIntent",
        setupIntentId: "seti_from_backend",
      },
      confirmCardSetup: {},
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(JSON.parse(fetchWithRetry.mock.calls[1]![1].body as string)).toMatchObject({
      setupIntentId: "seti_from_backend",
    });
  });

  it("fails a deferred SetupIntent that neither side can name", async () => {
    const { controller, authorize } = makeController({
      confirmResponse: {
        requiresAction: true,
        clientSecret: "seti_secret",
        intentType: "SetupIntent",
      },
      confirmCardSetup: {},
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "failed" });
  });

  it("fails when authenticating a deferred SetupIntent is refused", async () => {
    const { controller, authorize } = makeController({
      confirmResponse: {
        requiresAction: true,
        clientSecret: "seti_secret",
        intentType: "SetupIntent",
      },
      confirmCardSetup: { error: {} },
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "failed" });
  });

  it("fails when authenticating a deferred PaymentIntent is refused", async () => {
    const { controller, authorize } = makeController({
      confirmResponse: { requiresAction: true, clientSecret: "pi_secret" },
      confirmCardPayment: { error: {} },
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "failed" });
  });

  it("does nothing more when the backend asks for action without a secret", async () => {
    const { controller, stripe, authorize } = makeController({
      confirmResponse: { requiresAction: true, subscriptionId: "sub_1" },
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(stripe.confirmCardSetup).not.toHaveBeenCalled();
    expect(stripe.confirmCardPayment).not.toHaveBeenCalled();
  });

  it("survives a wallet whose complete() throws, and an unreadable confirm body", async () => {
    const { controller, fetchWithRetry, authorize, posted } = makeController();
    fetchWithRetry.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("no body")),
    });
    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize({
      complete: () => {
        throw new Error("sheet already gone");
      },
    });
    await expect(outcome).resolves.toEqual({ status: "failed" });
    expect(posted("stripe_checkout_fail")).toHaveLength(1);
  });
});

describe("what the wallet carries into a completion", () => {
  it("passes the backend's post-purchase behaviour through from the quote", async () => {
    const { controller, authorize } = makeController();
    await controller.prepare(quote({ postPurchaseBehavior: "REDIRECT" }));
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(completedSession().postPurchaseBehavior).toBe("REDIRECT");
  });
});

describe("what the wallet is asked to charge", () => {
  it("charges nothing up front for a SetupIntent quote that names no amount due", async () => {
    const { controller, requested } = makeController();
    await controller.prepare(
      quote({
        intentType: "SetupIntent",
        subscriptionDetails: { amount: 2000, currency: "usd", interval: "month", intervalCount: 1 },
      }),
    );
    expect(requested().total.amount).toBe(0);
  });

  it("charges the recurring amount for a PaymentIntent quote that names no amount due", async () => {
    const { controller, requested } = makeController();
    await controller.prepare(
      quote({
        subscriptionDetails: { amount: 2000, currency: "usd", interval: "month", intervalCount: 1 },
      }),
    );
    expect(requested().total.amount).toBe(2000);
  });

  it("assumes a US account and this origin's management page when the quote names neither", async () => {
    const { controller, requested } = makeController();
    await controller.prepare(quote({ stripeAccountCountryCode: undefined }));
    expect(requested().country).toBe("US");
    expect(requested().applePay.recurringPaymentRequest.managementURL).toBe(
      `${window.location.origin}/manage`,
    );
  });
});

describe("the confirm endpoint it talks to by default", () => {
  it("posts to the subscriptions API with the paywall's public key", async () => {
    const post = vi.fn(async () => new Response(JSON.stringify({ subscriptionId: "sub_1" })));
    vi.stubGlobal("fetch", post);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const paymentRequest = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
        return paymentRequest;
      }),
      canMakePayment: vi.fn().mockResolvedValue({ applePay: true }),
      show: vi.fn(),
    };
    const controller = createApplePay({
      publicApiKey: () => "pk_public",
      host: hostEvents(vi.fn()),
      loadStripe: vi.fn().mockResolvedValue({
        paymentRequest: () => paymentRequest,
        confirmCardPayment: vi.fn(),
        confirmCardSetup: vi.fn(),
      }) as never,
    });

    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await handlers.get("paymentmethod")!({ paymentMethod: { id: "pm_1" }, complete: vi.fn() });
    await expect(outcome).resolves.toEqual({ status: "completed" });

    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/subscriptions-api/public/v1/checkout/session/confirm");
    expect(init.headers).toMatchObject({ Authorization: "Bearer pk_public" });
    vi.unstubAllGlobals();
  });
});

describe("failures the wallet reports verbatim", () => {
  it("uses Stripe's message when it gives one, and its own when it does not", async () => {
    const secret = buildCheckoutSessionId({
      stripeCheckoutSessionId: "secret_1",
      environment: "test",
    });

    const setup = makeController({
      confirmCardSetup: { setupIntent: { id: "seti_1", status: "requires_action" } },
    });
    setup.stripe.confirmCardSetup
      .mockResolvedValueOnce({ setupIntent: { id: "seti_1", status: "requires_action" } })
      .mockResolvedValueOnce({ error: { message: "authentication declined" } });
    await setup.controller.prepare(quote({ intentType: "SetupIntent", checkoutSessionId: secret }));
    const first = setup.controller.purchase("primary", context);
    await setup.authorize();
    await expect(first).resolves.toEqual({ status: "failed" });

    const silent = makeController({
      confirmCardSetup: { setupIntent: { id: "seti_1", status: "requires_action" } },
    });
    silent.stripe.confirmCardSetup
      .mockResolvedValueOnce({ setupIntent: { id: "seti_1", status: "requires_action" } })
      .mockResolvedValueOnce({ error: {} });
    await silent.controller.prepare(
      quote({ intentType: "SetupIntent", checkoutSessionId: secret }),
    );
    const quiet = silent.controller.purchase("primary", context);
    await silent.authorize();
    await expect(quiet).resolves.toEqual({ status: "failed" });

    const payment = makeController({ confirmCardPayment: { error: {} } });
    await payment.controller.prepare(
      quote({ intentType: "PaymentIntent", checkoutSessionId: secret }),
    );
    const second = payment.controller.purchase("primary", context);
    await payment.authorize();
    await expect(second).resolves.toEqual({ status: "failed" });
  });

  it("reports a rejection that is not an Error as an Apple Pay failure", async () => {
    const { controller, fetchWithRetry, authorize } = makeController();
    fetchWithRetry.mockRejectedValue("the sheet vanished");
    const failure = vi.fn();
    const off = checkoutEvents.subscribe("PAYMENT_ERROR", failure);

    await controller.prepare(quote());
    const outcome = controller.purchase("primary", context);
    await authorize();
    await expect(outcome).resolves.toEqual({ status: "failed" });
    off();

    expect(failure.mock.calls[0]![0].error.message).toBe("Apple Pay failed");
  });
});
