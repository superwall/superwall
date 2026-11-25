import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkoutErrorOf,
  createElementsCheckout,
  type ElementsCheckoutOptions,
} from "../../../src/checkout/elements";
import { checkoutEvents } from "../../../src/checkout/events";
import { hostEvents, type HostContext } from "../../../src/checkout/host";
import { buildCheckoutSessionId } from "../../../src/checkout/session/id";
import type { ElementsCheckoutSession } from "../../../src/checkout/types";

const quote = (overrides: Partial<ElementsCheckoutSession> = {}): ElementsCheckoutSession => ({
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test_123",
  checkoutContextId: "ctx_1",
  referenceName: "primary",
  subscriptionDetails: { amount: 1999, currency: "usd", interval: "month", intervalCount: 1 },
  intentType: "PaymentIntent",
  ...overrides,
});

const context: HostContext = {
  checkoutContextId: "ctx_1",
  productIdentifier: "test:price_1:no-trial",
  paywallIdentifier: "paywall",
};

const makeStore = ({
  publicApiKey = "pk_public",
  stripeLoads = true,
  confirmResponse = { subscriptionId: "sub_1" } as Record<string, unknown>,
  confirmStatus = 200,
  overrides = {} as Partial<ElementsCheckoutOptions>,
} = {}) => {
  const stripe = {
    confirmCardPayment: vi.fn().mockResolvedValue({ paymentIntent: { status: "succeeded" } }),
    confirmCardSetup: vi.fn(),
  };
  const post = vi.fn();
  const loadStripe = vi.fn().mockResolvedValue(stripeLoads ? stripe : null);
  const fetchWithRetry = vi.fn(
    async () => new Response(JSON.stringify(confirmResponse), { status: confirmStatus }),
  );
  const store = createElementsCheckout({
    publicApiKey: () => publicApiKey,
    host: hostEvents(post),
    loadStripe: loadStripe as never,
    fetchWithRetry: fetchWithRetry as never,
    confirmUrl: () => "https://subscriptions.test/confirm",
    ...overrides,
  });
  const posted = () => post.mock.calls.map(([message]) => message.event_name as string);
  const bodies = () =>
    fetchWithRetry.mock.calls.map(
      (call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as unknown,
    );
  return { store, stripe, loadStripe, fetchWithRetry, posted, bodies };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkoutErrorOf", () => {
  it("keeps an error's name and message, and reads anything else as a plain error", () => {
    expect(checkoutErrorOf(new TypeError("boom"))).toEqual({ name: "TypeError", message: "boom" });
    expect(checkoutErrorOf("nope")).toEqual({ name: "Error", message: "nope" });
  });
});

describe("a product's quote for a form", () => {
  it("is not prepared until something asks for it", () => {
    const { store } = makeStore();
    expect(store.quoteOf("primary")).toEqual({ status: "unavailable", reason: "not_prepared" });
  });

  it("is preparing while the quote loads, then ready with Stripe loaded for its key", async () => {
    const { store, loadStripe, stripe } = makeStore();
    const heard = vi.fn();
    const stop = store.subscribe(heard);

    store.preparing("primary");
    expect(store.quoteOf("primary")).toEqual({ status: "preparing" });

    await store.prepare(quote());
    const ready = store.quoteOf("primary");
    expect(ready).toMatchObject({ status: "ready", quote: quote(), stripe });
    expect(store.quoteOf("primary")).toBe(ready);
    expect(loadStripe).toHaveBeenCalledWith("pk_test_123", {
      developerTools: { assistant: { enabled: false } },
    });
    expect(heard).toHaveBeenCalled();

    stop();
    heard.mockClear();
    store.clear();
    expect(heard).not.toHaveBeenCalled();
    expect(store.quoteOf("primary")).toEqual({ status: "unavailable", reason: "not_prepared" });
  });

  it("drops a quote that finishes loading after the store was cleared", async () => {
    const latch: { finish?: (stripe: unknown) => void } = {};
    const stripe = { confirmCardPayment: vi.fn() };
    const loadStripe = vi.fn(() => new Promise((resolve) => (latch.finish = resolve)));
    const late = createElementsCheckout({
      publicApiKey: () => "pk_public",
      host: hostEvents(vi.fn()),
      loadStripe: loadStripe as never,
    });
    const preparing = late.prepare(quote(), { stripeCustomerId: "cus_old" });
    late.clear();
    latch.finish?.(stripe);
    await preparing;
    expect(late.quoteOf("primary")).toEqual({ status: "unavailable", reason: "not_prepared" });
  });

  it("keeps the newer quote when an older preparation finishes last", async () => {
    const finishes: Array<(stripe: unknown) => void> = [];
    const stripe = { confirmCardPayment: vi.fn() };
    const loadStripe = vi.fn(() => new Promise((resolve) => finishes.push(resolve)));
    const store = createElementsCheckout({
      publicApiKey: () => "pk_public",
      host: hostEvents(vi.fn()),
      loadStripe: loadStripe as never,
    });
    const older = store.prepare(quote({ publishableKey: "pk_a", checkoutContextId: "ctx_old" }));
    const newer = store.prepare(quote({ publishableKey: "pk_b", checkoutContextId: "ctx_new" }));
    finishes[1]?.(stripe);
    await newer;
    finishes[0]?.(stripe);
    await older;
    expect(store.quoteOf("primary")).toMatchObject({
      status: "ready",
      quote: { checkoutContextId: "ctx_new" },
    });
  });

  it("drops a quote that finishes loading after the product was marked unavailable", async () => {
    const latch: { finish?: (stripe: unknown) => void } = {};
    const loadStripe = vi.fn(() => new Promise((resolve) => (latch.finish = resolve)));
    const store = createElementsCheckout({
      publicApiKey: () => "pk_public",
      host: hostEvents(vi.fn()),
      loadStripe: loadStripe as never,
    });
    const preparing = store.prepare(quote());
    store.markUnavailable("primary", "session_failed");
    latch.finish?.({});
    await preparing;
    expect(store.quoteOf("primary")).toEqual({ status: "unavailable", reason: "session_failed" });
  });

  it("is unavailable without a public API key, before loading Stripe", async () => {
    const { store, loadStripe } = makeStore({ publicApiKey: "" });
    await store.prepare(quote());
    expect(store.quoteOf("primary")).toEqual({
      status: "unavailable",
      reason: "missing_public_api_key",
    });
    expect(loadStripe).not.toHaveBeenCalled();
  });

  it("is unavailable when Stripe.js does not load", async () => {
    const { store } = makeStore({ stripeLoads: false });
    await store.prepare(quote());
    expect(store.quoteOf("primary")).toEqual({
      status: "unavailable",
      reason: "stripe_load_failed",
    });
  });

  it("loads Stripe once per key for every product, and again after a failed load", async () => {
    const { store, loadStripe, stripe } = makeStore();
    await Promise.all([
      store.prepare(quote()),
      store.prepare(quote({ referenceName: "secondary" })),
    ]);
    expect(loadStripe).toHaveBeenCalledOnce();
    expect(store.quoteOf("secondary")).toMatchObject({ status: "ready", stripe });

    loadStripe.mockResolvedValueOnce(null);
    await store.prepare(quote({ publishableKey: "pk_other", referenceName: "third" }));
    expect(store.quoteOf("third")).toMatchObject({ reason: "stripe_load_failed" });
    await store.prepare(quote({ publishableKey: "pk_other", referenceName: "third" }));
    expect(store.quoteOf("third")).toMatchObject({ status: "ready" });

    loadStripe.mockRejectedValueOnce(new Error("blocked"));
    await expect(
      store.prepare(quote({ publishableKey: "pk_third", referenceName: "fourth" })),
    ).rejects.toThrow("blocked");
    await store.prepare(quote({ publishableKey: "pk_third", referenceName: "fourth" }));
    expect(store.quoteOf("fourth")).toMatchObject({ status: "ready" });
  });

  it("keeps the error that made it unavailable", () => {
    const { store } = makeStore();
    store.markUnavailable("primary", "session_failed", new TypeError("Failed to fetch"));
    store.markUnavailable("secondary", "session_unsupported");
    expect(store.quoteOf("primary")).toEqual({
      status: "unavailable",
      reason: "session_failed",
      error: { name: "TypeError", message: "Failed to fetch" },
    });
    expect(store.quoteOf("secondary")).toEqual({
      status: "unavailable",
      reason: "session_unsupported",
    });
  });
});

describe("paying with a collected payment method", () => {
  it("submits, confirms through the shared core and reports success", async () => {
    const { store, posted, bodies } = makeStore();
    await store.prepare(quote({ postPurchaseBehavior: "REDEEM" }), {
      email: "known@b.co",
      stripeCustomerId: "cus_1",
    });
    const submitted = vi.fn();
    const succeeded = vi.fn();
    const stops = [
      checkoutEvents.subscribe("CHECKOUT_SUBMITTED", submitted),
      checkoutEvents.subscribe("PAYMENT_SUCCESS", succeeded),
    ];
    const onSubmit = vi.fn();

    const outcome = await store.pay("primary", { paymentMethodId: "pm_1" }, context, onSubmit);
    stops.forEach((stop) => stop());

    expect(outcome).toEqual({ status: "completed" });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(posted()).toEqual(["stripe_checkout_submit"]);
    expect(bodies()).toEqual([
      {
        checkoutContextId: "ctx_1",
        paymentMethodId: "pm_1",
        stripeCustomerId: "cus_1",
        email: "known@b.co",
      },
    ]);
    const session = {
      directive: "elements",
      referenceName: "primary",
      checkoutContextId: "ctx_1",
      checkoutSessionId: buildCheckoutSessionId({
        stripeCheckoutSessionId: "sub_1",
        environment: "test",
      }),
      postPurchaseBehavior: "REDEEM",
    };
    expect(submitted).toHaveBeenCalledWith({ session });
    expect(succeeded).toHaveBeenCalledWith({ session });
  });

  it("prefers the email the form collected over the one the paywall knows", async () => {
    const { store, bodies } = makeStore();
    await store.prepare(quote(), { email: "known@b.co" });
    await store.pay("primary", { paymentMethodId: "pm_1", email: "typed@b.co" }, context);
    expect(bodies()[0]).toMatchObject({ email: "typed@b.co" });
  });

  it("pays a trial quote the same way, naming its subscription", async () => {
    const { store } = makeStore();
    await store.prepare(quote({ checkoutSessionId: null, intentType: "SetupIntent" }));
    const succeeded = vi.fn();
    const stop = checkoutEvents.subscribe("PAYMENT_SUCCESS", succeeded);
    await store.pay("primary", { paymentMethodId: "pm_1" }, context);
    stop();
    expect(succeeded.mock.calls[0]?.[0].session.checkoutSessionId).toBe(
      buildCheckoutSessionId({ stripeCheckoutSessionId: "sub_1", environment: "test" }),
    );
  });

  it("reports a decline with its reason and keeps the quote for another try", async () => {
    const { store, posted } = makeStore({
      confirmStatus: 402,
      confirmResponse: {
        detail: "Your card was declined.",
        failure: { reason: "card_declined", code: "card_declined" },
      },
    });
    await store.prepare(quote());
    const errored = vi.fn();
    const stop = checkoutEvents.subscribe("PAYMENT_ERROR", errored);

    const outcome = await store.pay("primary", { paymentMethodId: "pm_1" }, context);
    stop();

    expect(outcome).toMatchObject({
      status: "failed",
      failure: { reason: "card_declined", store: "stripe" },
    });
    expect(posted()).toEqual(["stripe_checkout_submit", "stripe_checkout_fail"]);
    expect(errored.mock.calls[0]?.[0]).toMatchObject({
      error: expect.any(Error),
      failure: { reason: "card_declined" },
    });
    expect(store.quoteOf("primary").status).toBe("ready");
  });

  it("wraps something that is not an error before reporting it", async () => {
    const { store } = makeStore({
      overrides: { fetchWithRetry: vi.fn().mockRejectedValue("offline") as never },
    });
    await store.prepare(quote());
    const errored = vi.fn();
    const stop = checkoutEvents.subscribe("PAYMENT_ERROR", errored);
    const outcome = await store.pay("primary", { paymentMethodId: "pm_1" }, context);
    stop();
    expect(outcome).toEqual({ status: "failed", failure: { reason: "unknown", store: "stripe" } });
    expect(errored.mock.calls[0]?.[0].error).toEqual(new Error("Payment failed"));
  });

  it("refuses to pay when the quote changed after the shopper started paying", async () => {
    const { store, posted, fetchWithRetry } = makeStore();
    const original = quote();
    await store.prepare(original);
    await store.prepare(quote({ checkoutContextId: "ctx_2" }));

    const outcome = await store.pay(
      "primary",
      { paymentMethodId: "pm_1" },
      context,
      undefined,
      original,
    );

    expect(outcome).toEqual({
      status: "failed",
      failure: expect.objectContaining({ reason: "unknown", code: "quote_changed" }),
    });
    expect(fetchWithRetry).not.toHaveBeenCalled();
    expect(posted()).toEqual(["stripe_checkout_fail"]);
  });

  it("refuses to pay when the quote was cleared after the shopper started paying", async () => {
    const { store, fetchWithRetry } = makeStore();
    const original = quote();
    await store.prepare(original);
    store.clear();

    const outcome = await store.pay(
      "primary",
      { paymentMethodId: "pm_1" },
      context,
      undefined,
      original,
    );

    expect(outcome).toMatchObject({ status: "failed", failure: { code: "quote_changed" } });
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("pays the quote the shopper started with when it is still current", async () => {
    const { store } = makeStore();
    const original = quote();
    await store.prepare(original);
    const outcome = await store.pay(
      "primary",
      { paymentMethodId: "pm_1" },
      context,
      undefined,
      original,
    );
    expect(outcome).toEqual({ status: "completed" });
  });

  it("refuses a product that is not ready, and a second tap while one is paying", async () => {
    const { store, fetchWithRetry } = makeStore();
    await expect(store.pay("primary", { paymentMethodId: "pm_1" }, context)).resolves.toEqual({
      status: "failed",
      failure: { reason: "unknown", store: "stripe" },
    });

    await store.prepare(quote());
    const first = store.pay("primary", { paymentMethodId: "pm_1" }, context);
    await expect(store.pay("primary", { paymentMethodId: "pm_2" }, context)).resolves.toEqual({
      status: "failed",
      failure: { reason: "unknown", store: "stripe" },
    });
    await expect(first).resolves.toEqual({ status: "completed" });
    expect(fetchWithRetry).toHaveBeenCalledOnce();

    await expect(store.pay("primary", { paymentMethodId: "pm_3" }, context)).resolves.toEqual({
      status: "completed",
    });
  });
});
