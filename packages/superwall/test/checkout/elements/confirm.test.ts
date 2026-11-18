import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stripe } from "@stripe/stripe-js";
import { createConfirmation, type PaymentToConfirm } from "../../../src/checkout/elements/confirm";
import { CheckoutFailureError } from "../../../src/checkout/failure";
import { buildCheckoutSessionId } from "../../../src/checkout/session/id";
import type { ElementsCheckoutSession } from "../../../src/checkout/types";

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

const sessionFor = (clientSecret: string) =>
  buildCheckoutSessionId({ stripeCheckoutSessionId: clientSecret, environment: "test" });

type Reply = { status?: number; body: unknown };

const setup = (replies: Reply[], stripeOverrides: Partial<Record<string, unknown>> = {}) => {
  const queue = [...replies];
  const fetchWithRetry = vi.fn(async (_url: string, _init: RequestInit, _retry?: unknown) => {
    const reply = queue.shift() ?? { body: {} };
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (reply.body instanceof Error) throw reply.body;
        return reply.body;
      },
    } as Response;
  });
  const stripe = {
    confirmCardPayment: vi.fn().mockResolvedValue({ paymentIntent: { status: "succeeded" } }),
    confirmCardSetup: vi
      .fn()
      .mockResolvedValue({ setupIntent: { id: "seti_1", status: "succeeded" } }),
    handleNextAction: vi
      .fn()
      .mockResolvedValue({ setupIntent: { id: "seti_1", status: "succeeded" } }),
    confirmPayment: vi
      .fn()
      .mockResolvedValue({ paymentIntent: { id: "pi_1", status: "succeeded" } }),
    ...stripeOverrides,
  } as unknown as Stripe & {
    confirmCardPayment: ReturnType<typeof vi.fn>;
    confirmCardSetup: ReturnType<typeof vi.fn>;
    handleNextAction: ReturnType<typeof vi.fn>;
    confirmPayment: ReturnType<typeof vi.fn>;
  };
  const confirmation = createConfirmation({
    publicApiKey: () => "pk_superwall",
    fetchWithRetry,
    confirmUrl: () => "https://api.test/confirm",
  });
  const onAuthorized = vi.fn();
  const onSubscription = vi.fn();
  const pay = (overrides: Partial<PaymentToConfirm> = {}) =>
    confirmation.confirm({
      name: "Test",
      stripe,
      quote: quote(),
      paymentMethodId: "pm_1",
      stripeCustomerId: "cus_1",
      email: "a@b.co",
      onAuthorized,
      onSubscription,
      ...overrides,
    });
  const bodies = () =>
    fetchWithRetry.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as unknown);
  return { stripe, fetchWithRetry, onAuthorized, onSubscription, pay, bodies };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createConfirmation, deferred intent", () => {
  it("confirms the payment method with the backend and reports the subscription", async () => {
    const { pay, fetchWithRetry, bodies, onAuthorized, onSubscription, stripe } = setup([
      { body: { subscriptionId: "sub_1", requiresAction: false } },
    ]);

    await pay();

    const [url, init, retry] = fetchWithRetry.mock.calls[0]!;
    expect(url).toBe("https://api.test/confirm");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer pk_superwall",
    });
    expect(retry).toEqual({ retries: 0, returnClientErrors: true });
    expect(bodies()).toEqual([
      {
        checkoutContextId: "ctx_123",
        paymentMethodId: "pm_1",
        stripeCustomerId: "cus_1",
        email: "a@b.co",
      },
    ]);
    expect(onSubscription).toHaveBeenCalledWith("sub_1");
    expect(onAuthorized).toHaveBeenCalledOnce();
    expect(stripe.confirmCardPayment).not.toHaveBeenCalled();
  });

  it("treats a session id it cannot decode as deferred", async () => {
    const { pay, bodies } = setup([{ body: {} }]);

    await pay({ quote: quote({ checkoutSessionId: "not-a-session" }) });

    expect(bodies()[0]).toMatchObject({ paymentMethodId: "pm_1" });
  });

  it("does nothing more when the backend asks for an action but sends no secret", async () => {
    const { pay, stripe, onSubscription } = setup([{ body: { requiresAction: true } }]);

    await pay();

    expect(onSubscription).not.toHaveBeenCalled();
    expect(stripe.handleNextAction).not.toHaveBeenCalled();
    expect(stripe.confirmPayment).not.toHaveBeenCalled();
  });

  it("confirms the unpaid first invoice on the client, running 3D Secure if asked", async () => {
    const { pay, stripe, onAuthorized } = setup([
      { body: { requiresAction: true, clientSecret: "pi_secret", intentType: "PaymentIntent" } },
    ]);

    await pay();

    expect(onAuthorized).toHaveBeenCalledOnce();
    expect(stripe.confirmPayment).toHaveBeenCalledWith({
      clientSecret: "pi_secret",
      confirmParams: { payment_method: "pm_1" },
      redirect: "if_required",
    });
    expect(stripe.handleNextAction).not.toHaveBeenCalled();
    expect(stripe.confirmCardPayment).not.toHaveBeenCalled();
  });

  it("confirms a Link payment with Stripe's generic call, not a card-only one", async () => {
    const { pay, stripe, bodies } = setup([
      { body: { requiresAction: true, clientSecret: "pi_secret", intentType: "PaymentIntent" } },
    ]);

    await pay({ paymentMethodId: "pm_link" });

    expect(bodies()[0]).toMatchObject({ paymentMethodId: "pm_link" });
    expect(stripe.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({ confirmParams: { payment_method: "pm_link" } }),
    );
    expect(stripe.confirmCardPayment).not.toHaveBeenCalled();
    expect(stripe.confirmCardSetup).not.toHaveBeenCalled();
  });

  it("maps a failed 3D Secure payment to a checkout failure", async () => {
    const { pay } = setup([{ body: { requiresAction: true, clientSecret: "pi_secret" } }], {
      confirmPayment: vi.fn().mockResolvedValue({
        error: { code: "card_declined", decline_code: "insufficient_funds", message: "No funds" },
      }),
    });

    const error = await pay().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CheckoutFailureError);
    expect((error as CheckoutFailureError).failure).toMatchObject({
      reason: "insufficient_funds",
      message: "No funds",
    });
  });

  it("falls back to its own message when Stripe gives none", async () => {
    const { pay } = setup([{ body: { requiresAction: true, clientSecret: "pi_secret" } }], {
      confirmPayment: vi.fn().mockResolvedValue({ error: {} }),
    });

    await expect(pay()).rejects.toThrow("Payment authentication failed");
  });

  it("authenticates a trial's SetupIntent and confirms it with the backend", async () => {
    const { pay, stripe, bodies, onSubscription } = setup([
      {
        body: {
          subscriptionId: "sub_1",
          requiresAction: true,
          clientSecret: "seti_secret",
          intentType: "SetupIntent",
        },
      },
      { body: { subscriptionId: "sub_2" } },
    ]);

    await pay({ email: undefined });

    expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: "seti_secret" });
    expect(stripe.confirmCardSetup).not.toHaveBeenCalled();
    expect(bodies()[1]).toEqual({ checkoutContextId: "ctx_123", setupIntentId: "seti_1" });
    expect(onSubscription.mock.calls).toEqual([["sub_1"], ["sub_2"]]);
  });

  it("uses the backend's SetupIntent id when Stripe returns none", async () => {
    const { pay, bodies } = setup(
      [
        {
          body: {
            requiresAction: true,
            clientSecret: "seti_secret",
            intentType: "SetupIntent",
            setupIntentId: "seti_backend",
          },
        },
        { body: {} },
      ],
      { handleNextAction: vi.fn().mockResolvedValue({}) },
    );

    await pay();

    expect(bodies()[1]).toMatchObject({ setupIntentId: "seti_backend" });
  });

  it("fails when neither Stripe nor the backend names the SetupIntent", async () => {
    const { pay } = setup(
      [{ body: { requiresAction: true, clientSecret: "seti_secret", intentType: "SetupIntent" } }],
      { handleNextAction: vi.fn().mockResolvedValue({}) },
    );

    await expect(pay()).rejects.toThrow("No SetupIntent returned");
  });

  it("maps a failed SetupIntent authentication to a checkout failure", async () => {
    const { pay } = setup(
      [{ body: { requiresAction: true, clientSecret: "seti_secret", intentType: "SetupIntent" } }],
      { handleNextAction: vi.fn().mockResolvedValue({ error: {} }) },
    );

    await expect(pay()).rejects.toThrow("Setup authentication failed");
  });

  it("throws the backend's failure when it refuses the payment", async () => {
    const { pay, onAuthorized } = setup([
      {
        status: 402,
        body: {
          error: { message: "Your card was declined." },
          failure: { code: "card_declined", declineCode: "expired_card" },
        },
      },
    ]);

    const error = await pay().catch((caught: unknown) => caught);

    expect(onAuthorized).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(CheckoutFailureError);
    expect((error as Error).message).toBe("Your card was declined.");
    expect((error as CheckoutFailureError).failure.reason).toBe("expired_card");
  });

  it("reports an unknown failure when the refusal has no readable body", async () => {
    const { pay } = setup([{ status: 500, body: new Error("not json") }]);

    const error = await pay().catch((caught: unknown) => caught);

    expect((error as Error).message).toBe("Checkout confirmation failed (500)");
    expect((error as CheckoutFailureError).failure.reason).toBe("unknown");
  });

  it("posts to the subscriptions API when no confirm URL is given", async () => {
    const fetchWithRetry = vi.fn(
      async (_url: string, _init: RequestInit) =>
        ({ ok: true, status: 200, json: async () => ({}) }) as Response,
    );
    const confirmation = createConfirmation({ publicApiKey: () => "pk", fetchWithRetry });

    await confirmation.confirm({
      name: "Test",
      stripe: {} as Stripe,
      quote: quote(),
      paymentMethodId: "pm_1",
      onAuthorized: () => undefined,
      onSubscription: () => undefined,
    });

    expect(String(fetchWithRetry.mock.calls[0]![0])).toContain("checkout/session/confirm");
  });
});

describe("createConfirmation, default transport", () => {
  it("posts with the browser's fetch when no transport is given", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const confirmation = createConfirmation({
      publicApiKey: () => "pk",
      confirmUrl: () => "https://api.test/confirm",
    });

    await confirmation.confirm({
      name: "Test",
      stripe: {} as Stripe,
      quote: quote(),
      paymentMethodId: "pm_1",
      onAuthorized: () => undefined,
      onSubscription: () => undefined,
    });

    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe("createConfirmation, SetupIntent the backend already created", () => {
  const trial = () =>
    quote({ checkoutSessionId: sessionFor("seti_secret"), intentType: "SetupIntent" });

  it("confirms the setup, then the backend, then authorizes", async () => {
    const { pay, stripe, bodies, onAuthorized } = setup([{ body: { subscriptionId: "sub_1" } }]);

    await pay({ quote: trial() });

    expect(stripe.confirmCardSetup).toHaveBeenCalledWith(
      "seti_secret",
      { payment_method: "pm_1" },
      { handleActions: false },
    );
    expect(bodies()).toEqual([
      { checkoutContextId: "ctx_123", setupIntentId: "seti_1", email: "a@b.co" },
    ]);
    expect(onAuthorized).toHaveBeenCalledOnce();
  });

  it("runs the bank's check when the setup needs one", async () => {
    const confirmCardSetup = vi
      .fn()
      .mockResolvedValueOnce({ setupIntent: { id: "seti_1", status: "requires_action" } })
      .mockResolvedValueOnce({ setupIntent: { id: "seti_2", status: "succeeded" } });
    const { pay, bodies } = setup([{ body: {} }], { confirmCardSetup });

    await pay({ quote: trial() });

    expect(confirmCardSetup).toHaveBeenLastCalledWith("seti_secret");
    expect(bodies()[0]).toMatchObject({ setupIntentId: "seti_2" });
  });

  it("fails when the bank's check fails", async () => {
    const confirmCardSetup = vi
      .fn()
      .mockResolvedValueOnce({ setupIntent: { id: "seti_1", status: "requires_action" } })
      .mockResolvedValueOnce({ error: { decline_code: "authentication_required" } });
    const { pay, onAuthorized } = setup([], { confirmCardSetup });

    const error = await pay({ quote: trial() }).catch((caught: unknown) => caught);

    expect((error as CheckoutFailureError).failure.reason).toBe("authentication_failed");
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("fails when Stripe declines the setup", async () => {
    const { pay } = setup([], { confirmCardSetup: vi.fn().mockResolvedValue({ error: {} }) });

    await expect(pay({ quote: trial() })).rejects.toThrow("Setup failed");
  });

  it("fails when Stripe returns no SetupIntent", async () => {
    const { pay } = setup([], { confirmCardSetup: vi.fn().mockResolvedValue({}) });

    await expect(pay({ quote: trial() })).rejects.toThrow("No SetupIntent returned");
  });
});

describe("createConfirmation, PaymentIntent the backend already created", () => {
  const paid = () => quote({ checkoutSessionId: sessionFor("pi_secret") });

  it("authorizes once Stripe accepts the payment, then tells the backend", async () => {
    const { pay, stripe, bodies, onAuthorized, onSubscription } = setup([
      { body: { subscriptionId: "sub_1" } },
    ]);

    await pay({ quote: paid() });

    expect(stripe.confirmCardPayment).toHaveBeenCalledWith(
      "pi_secret",
      { payment_method: "pm_1" },
      { handleActions: false },
    );
    expect(onAuthorized).toHaveBeenCalledOnce();
    expect(bodies()).toEqual([{ checkoutContextId: "ctx_123", email: "a@b.co" }]);
    expect(onSubscription).toHaveBeenCalledWith("sub_1");
  });

  it("runs 3D Secure when the payment needs it", async () => {
    const confirmCardPayment = vi
      .fn()
      .mockResolvedValueOnce({ paymentIntent: { status: "requires_action" } })
      .mockResolvedValueOnce({ paymentIntent: { status: "succeeded" } });
    const { pay } = setup([{ body: {} }], { confirmCardPayment });

    await pay({ quote: paid() });

    expect(confirmCardPayment).toHaveBeenLastCalledWith("pi_secret");
  });

  it("fails when 3D Secure fails", async () => {
    const confirmCardPayment = vi
      .fn()
      .mockResolvedValueOnce({ paymentIntent: { status: "requires_action" } })
      .mockResolvedValueOnce({ error: {} });
    const { pay } = setup([], { confirmCardPayment });

    await expect(pay({ quote: paid() })).rejects.toThrow("Payment authentication failed");
  });

  it("fails before authorizing when Stripe declines", async () => {
    const { pay, onAuthorized } = setup([], {
      confirmCardPayment: vi.fn().mockResolvedValue({ error: { code: "card_declined" } }),
    });

    await expect(pay({ quote: paid() })).rejects.toBeInstanceOf(CheckoutFailureError);
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("logs, under the caller's name, a backend confirm that fails after the money moved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pay } = setup([{ status: 500, body: {} }]);

    await pay({ quote: paid() });

    expect(logged).toHaveBeenCalledWith(
      "[Test] Post-payment confirm failed (non-fatal):",
      expect.any(CheckoutFailureError),
    );
  });
});
