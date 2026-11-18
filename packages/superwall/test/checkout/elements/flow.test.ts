import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { checkoutEvents, purchaseEventsFor } from "../../../src/checkout/events";
import {
  applePayFor,
  autoPrefetchTargets,
  elementsFor,
  invalidateSessions,
  lastWebFailure,
  prefetchSession,
  purchaseOnWeb,
  reprefetch,
  purchaseWithApplePay,
  purchaseWithElements,
  sessionsFor,
  watchCompletedCheckouts,
  type PaywallSession,
} from "../../../src/checkout/flow";
import type {
  ElementsCheckoutSession,
  EmbeddedCheckoutSession,
  RedirectCheckoutSession,
} from "../../../src/checkout/types";

const wallet = {
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  paymentRequest: {} as Record<string, unknown>,
};

const stripe = {
  paymentRequest: vi.fn(() => wallet.paymentRequest),
  confirmCardPayment: vi.fn(),
  confirmCardSetup: vi.fn(),
};

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: vi.fn(async () => stripe) }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeSession = ({
  checkout = "elements" as SuperwallCheckoutConfig,
  publicApiKey = "pk_test",
  references = ["primary", "secondary"],
} = {}) => {
  const products = references.map((reference, index) => ({
    reference,
    productId: `test:price_${index + 1}:no-trial`,
    variables: {},
    source: "sdk" as const,
  }));
  const postMessage = vi.fn();
  const session: PaywallSession = {
    getSnapshot: () =>
      ({
        device: { publicApiKey, sdkVersionPadded: "004.020.000" },
        user: {},
        params: {},
        products,
        productsByReference: Object.fromEntries(products.map((p) => [p.reference, p])),
        introductoryOffer: { eligible: false },
        config: { checkout },
      }) as never,
    postMessage,
  };
  const messages = () =>
    postMessage.mock.calls
      .map(([message]) => message.event_name as string)
      .filter((name) => name !== "stripe_checkout_diagnostic");
  return { session, postMessage, messages };
};

const quote = (overrides: Partial<ElementsCheckoutSession> = {}): ElementsCheckoutSession => ({
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test",
  checkoutContextId: "ctx_3",
  referenceName: "primary",
  subscriptionDetails: { amount: 1999, currency: "usd", interval: "month", intervalCount: 1 },
  intentType: "PaymentIntent",
  ...overrides,
});

const embedded: EmbeddedCheckoutSession = {
  directive: "embedded",
  checkoutSessionId: "sw_checkout_1",
  clientSecret: "cs_secret",
  publishableKey: "pk_test",
  checkoutContextId: "ctx_1",
  referenceName: "primary",
};

const redirect: RedirectCheckoutSession = {
  directive: "redirect",
  checkoutSessionId: "sw_checkout_2",
  checkoutUrl: "#hosted",
  checkoutContextId: "ctx_2",
  referenceName: "primary",
};

const answerConfirm = (body: unknown, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

const DECLINE = {
  detail: "Your card was declined.",
  failure: { reason: "card_declined", code: "card_declined" },
};

const recordPurchaseEvents = (session: PaywallSession) => {
  const heard: string[] = [];
  const bus = purchaseEventsFor(session);
  const stops = (["start", "submit", "complete", "abandon", "failure"] as const).map((event) =>
    bus.on(event, () => heard.push(event)),
  );
  return { heard, stop: () => stops.forEach((stop) => stop()) };
};

beforeEach(() => {
  wallet.handlers.clear();
  wallet.paymentRequest = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      wallet.handlers.set(event, handler);
      return wallet.paymentRequest;
    }),
    canMakePayment: vi.fn().mockResolvedValue({ applePay: true }),
    show: vi.fn(),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("elementsFor", () => {
  it("keeps one form store per paywall, cleared when its sessions are", async () => {
    const { session } = fakeSession();
    const { session: other } = fakeSession();
    expect(elementsFor(session)).toBe(elementsFor(session));
    expect(elementsFor(session)).not.toBe(elementsFor(other));

    await elementsFor(session).prepare(quote());
    expect(elementsFor(session).quoteOf("primary").status).toBe("ready");
    invalidateSessions(session, "test");
    expect(elementsFor(session).quoteOf("primary")).toEqual({
      status: "unavailable",
      reason: "not_prepared",
    });
  });
});

describe("warming an elements paywall", () => {
  it("warms every Stripe product, as Apple Pay does, so a plan picker never waits", () => {
    const { session } = fakeSession({ references: ["a", "b", "c"] });
    expect(autoPrefetchTargets(session, "elements")).toEqual(["a", "b", "c"]);
  });

  it("readies the form for each Stripe product when the paywall opens", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockImplementation(async ({ referenceName }) =>
      quote({ referenceName, checkoutContextId: `ctx_${referenceName}` }),
    );

    expect(reprefetch(session)).toBe(true);

    await vi.waitFor(() => {
      expect(elementsFor(session).quoteOf("primary").status).toBe("ready");
      expect(elementsFor(session).quoteOf("secondary").status).toBe("ready");
    });
  });

  it("asks for a deferred quote and readies the form with it", async () => {
    const { session, postMessage } = fakeSession();
    const prefetch = vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(quote());

    const warming = prefetchSession(session, "primary", "elements");
    expect(elementsFor(session).quoteOf("primary")).toEqual({ status: "preparing" });
    await warming;

    expect(prefetch).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "elements", scope: "elements", silent: true }),
    );
    expect(elementsFor(session).quoteOf("primary")).toMatchObject({
      status: "ready",
      quote: quote(),
      stripe,
    });
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      event_name: "stripe_checkout_prefetch",
    });
  });

  it("leaves a ready form alone when the same quote comes back from the cache", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(quote());
    await prefetchSession(session, "primary", "elements");
    const ready = elementsFor(session).quoteOf("primary");
    const prepare = vi.spyOn(elementsFor(session), "prepare");

    await prefetchSession(session, "primary", "elements");

    expect(prepare).not.toHaveBeenCalled();
    expect(elementsFor(session).quoteOf("primary")).toBe(ready);

    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(quote({ checkoutContextId: "x" }));
    await prefetchSession(session, "primary", "elements");
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("marks the form unavailable when Stripe.js throws while loading", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(quote());
    vi.spyOn(elementsFor(session), "prepare").mockRejectedValue(new Error("stripe down"));

    await prefetchSession(session, "primary", "elements");

    expect(elementsFor(session).quoteOf("primary")).toEqual({
      status: "unavailable",
      reason: "stripe_load_failed",
      error: { name: "Error", message: "stripe down" },
    });
  });

  it("marks the form unavailable with the error when the quote request fails", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await prefetchSession(session, "primary", "elements");

    expect(elementsFor(session).quoteOf("primary")).toEqual({
      status: "unavailable",
      reason: "session_failed",
      error: { name: "TypeError", message: "Failed to fetch" },
    });
  });

  it("marks the form unsupported for a sheet or hosted page, and pools the sheet", async () => {
    const { session } = fakeSession();
    const pooled = vi.fn();
    const stop = checkoutEvents.subscribe("SESSION_PREFETCHED", pooled);
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValueOnce(embedded);
    await prefetchSession(session, "primary", "elements");
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValueOnce(redirect);
    await prefetchSession(session, "secondary", "elements");
    stop();

    expect(pooled).toHaveBeenCalledWith(embedded);
    for (const reference of ["primary", "secondary"]) {
      expect(elementsFor(session).quoteOf(reference)).toEqual({
        status: "unavailable",
        reason: "session_unsupported",
      });
    }
  });

  it("touches no form store in the other modes", async () => {
    const { session } = fakeSession({ checkout: "applePay" });
    vi.spyOn(sessionsFor(session), "prefetch").mockRejectedValue(new Error("offline"));
    await prefetchSession(session, "primary", "applePay");
    expect(elementsFor(session).quoteOf("primary")).toEqual({
      status: "unavailable",
      reason: "not_prepared",
    });
  });
});

describe("purchaseWithElements", () => {
  it("pays with the collected method and reports the purchase from start to completion", async () => {
    const { session, messages } = fakeSession();
    const stopWatching = watchCompletedCheckouts(session);
    await elementsFor(session).prepare(quote());
    answerConfirm({ subscriptionId: "sub_1" });
    const { heard, stop } = recordPurchaseEvents(session);
    const collect = vi.fn(async () => ({ paymentMethodId: "pm_1" }));

    const outcome = await purchaseWithElements(session, "primary", collect, {
      stripeMetadata: { campaign: "spring" },
    });
    await flush();
    stop();
    stopWatching();

    expect(outcome).toEqual({ status: "completed" });
    expect(collect).toHaveBeenCalledOnce();
    expect(heard).toEqual(["start", "submit", "complete"]);
    expect(messages()).toEqual([
      "initiate_web_checkout",
      "stripe_checkout_start",
      "stripe_checkout_submit",
      "stripe_checkout_complete",
    ]);
  });

  it("reports an abandon when the shopper backs out before paying", async () => {
    const { session, messages } = fakeSession();
    await elementsFor(session).prepare(quote());
    const { heard, stop } = recordPurchaseEvents(session);

    const outcome = await purchaseWithElements(session, "primary", async () => null);
    stop();

    expect(outcome).toEqual({ status: "abandoned" });
    expect(heard).toEqual(["start", "abandon"]);
    expect(messages()).toEqual([
      "initiate_web_checkout",
      "stripe_checkout_start",
      "stripe_checkout_abandon",
    ]);
  });

  it("reports a decline as the paywall's last failure, with its reason", async () => {
    const { session, messages } = fakeSession();
    await elementsFor(session).prepare(quote());
    answerConfirm(DECLINE, 402);
    const { heard, stop } = recordPurchaseEvents(session);

    const outcome = await purchaseWithElements(session, "primary", async () => ({
      paymentMethodId: "pm_1",
    }));
    stop();

    expect(outcome).toMatchObject({ status: "failed", failure: { reason: "card_declined" } });
    expect(heard).toEqual(["start", "submit", "failure"]);
    expect(lastWebFailure(session)).toMatchObject({
      referenceName: "primary",
      failure: { reason: "card_declined" },
    });
    expect(messages()).toContain("stripe_checkout_fail");
  });

  it("fails with the reason Stripe gave when collecting the payment method throws", async () => {
    const { session, messages } = fakeSession();
    await elementsFor(session).prepare(quote());

    const outcome = await purchaseWithElements(session, "primary", async () => {
      throw new Error("Your card number is incomplete.");
    });

    expect(outcome).toEqual({ status: "failed", failure: { reason: "unknown", store: "stripe" } });
    expect(messages()).toEqual([
      "initiate_web_checkout",
      "stripe_checkout_start",
      "stripe_checkout_fail",
    ]);
  });

  it("fails at once, telling the host nothing, when the form's quote is not ready", async () => {
    const { session, messages } = fakeSession();
    const collect = vi.fn();

    const outcome = await purchaseWithElements(session, "primary", collect);

    expect(outcome).toEqual({ status: "failed", failure: { reason: "unknown", store: "stripe" } });
    expect(collect).not.toHaveBeenCalled();
    expect(messages()).toEqual([]);
  });
});

describe("a form purchase and an Apple Pay purchase report the same way", () => {
  type Run = (
    session: PaywallSession,
    end: "pay" | "cancel" | "decline",
  ) => Promise<{ status: string }>;

  const throughForm: Run = async (session, end) => {
    await elementsFor(session).prepare(quote());
    return purchaseWithElements(session, "primary", async () =>
      end === "cancel" ? null : { paymentMethodId: "pm_1" },
    );
  };

  const throughWallet: Run = async (session, end) => {
    await applePayFor(session).prepare(quote());
    sessionsFor(session).cache.set("primary", quote(), "elements");
    const outcome = purchaseOnWeb(session, "primary", "applePay");
    await flush();
    if (end === "cancel") wallet.handlers.get("cancel")?.();
    else {
      void wallet.handlers.get("paymentmethod")?.({
        paymentMethod: { id: "pm_1" },
        complete: vi.fn(),
      });
    }
    return outcome;
  };

  for (const end of ["pay", "cancel", "decline"] as const) {
    it(`fires the same purchase events and host messages when the shopper's ${end} ends it`, async () => {
      const heard: Record<string, { events: string[]; messages: string[]; status: string }> = {};
      for (const [name, run] of [
        ["form", throughForm],
        ["wallet", throughWallet],
      ] as const) {
        const { session, messages } = fakeSession({
          checkout: name === "form" ? "elements" : "applePay",
        });
        const stopWatching = watchCompletedCheckouts(session);
        if (end === "decline") answerConfirm(DECLINE, 402);
        else answerConfirm({ subscriptionId: "sub_1" });
        const { heard: events, stop } = recordPurchaseEvents(session);
        const outcome = await run(session, end);
        await flush();
        stop();
        stopWatching();
        heard[name] = { events, messages: messages(), status: outcome.status };
      }
      expect(heard.form).toEqual(heard.wallet);
    });
  }

  it("lets the wallet path still go through the shared core", async () => {
    const { session } = fakeSession({ checkout: "applePay" });
    answerConfirm({ subscriptionId: "sub_1" });
    await applePayFor(session).prepare(quote());
    const outcome = purchaseWithApplePay(session, "primary");
    await flush();
    void wallet.handlers.get("paymentmethod")?.({
      paymentMethod: { id: "pm_1" },
      complete: vi.fn(),
    });
    await expect(outcome).resolves.toEqual({ status: "completed" });
  });
});

describe("a plain purchase on an elements paywall", () => {
  it("opens the sheet, reusing one the warm-up already produced", async () => {
    const { session } = fakeSession();
    sessionsFor(session).cache.set("primary", embedded, "elements");
    const begin = vi.spyOn(sessionsFor(session), "begin");
    const openWallet = vi.spyOn(applePayFor(session), "purchase");

    const outcome = purchaseOnWeb(session, "primary", "elements");
    await Promise.resolve();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);

    await expect(outcome).resolves.toEqual({ status: "abandoned" });
    expect(begin).not.toHaveBeenCalled();
    expect(openWallet).not.toHaveBeenCalled();
  });

  it("asks for a fresh sheet when the warm-up produced a form quote", async () => {
    const { session } = fakeSession();
    sessionsFor(session).cache.set("primary", quote(), "elements");
    const begin = vi.spyOn(sessionsFor(session), "begin").mockResolvedValue(redirect);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await purchaseOnWeb(session, "primary", "elements");

    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({ referenceName: "primary", mode: "sheet", scope: "default" }),
    );
  });
});
