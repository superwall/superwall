import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WebCheckoutController,
  isStripeProductIdentifier,
} from "../../src/checkout/services/WebCheckoutController";
import { sessionCache } from "../../src/checkout/services/SessionCache";
import { checkoutEvents } from "../../src/checkout/services/CheckoutEvents";
import { openEmbeddedCheckout } from "../../src/checkout/services/registry";
import type { SessionData } from "../../src/checkout/state/types";

const SECRET = "cs_test_abc_secret_xyz";
const SW_SESSION_ID = `sw_checkout_${btoa(
  JSON.stringify({ provider: "stripe", env: "test", stripeCheckoutSessionId: SECRET }),
)}`;

const snapshot = (overrides: Record<string, unknown> = {}) =>
  ({
    device: { publicApiKey: "pk_test", platform: "web" },
    user: {},
    params: {},
    introductoryOffer: { eligible: false },
    paywall: undefined,
    experiment: undefined,
    products: [{ reference: "monthly", productId: "test:price_1:no-trial" }],
    productsByReference: {
      monthly: {
        reference: "monthly",
        product: "monthly",
        productId: "test:price_1:no-trial",
        variables: {},
      },
      store_only: {
        reference: "store_only",
        product: "store_only",
        productId: "pro_999_month",
        variables: {},
      },
      prefixed: {
        reference: "prefixed",
        product: "prefixed",
        productId: "stripe|test:price_2:no-trial",
        variables: {},
      },
    },
    config: {},
    ...overrides,
  }) as never;

const mockSession = (directive: Record<string, unknown>) => {
  const fetchMock = vi.fn(
    async (..._args: [string, RequestInit?]) =>
      new Response(JSON.stringify(directive), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionCache.clear();
});

describe("isStripeProductIdentifier", () => {
  it("matches bare and store-prefixed stripe composites, rejects store ids", () => {
    expect(isStripeProductIdentifier("test:price_1:no-trial")).toBe(true);
    expect(isStripeProductIdentifier("live:price_1:trial")).toBe(true);
    expect(isStripeProductIdentifier("stripe|test:price_1:no-trial")).toBe(true);
    expect(isStripeProductIdentifier("pro_999_month")).toBe(false);
    expect(isStripeProductIdentifier(undefined)).toBe(false);
  });
});

describe("WebCheckoutController.createSession", () => {
  it("sends the v4 checkout context: presentment ids, bare identifier, embedded directives", async () => {
    const fetchMock = mockSession({
      checkoutContextId: "ctx_1",
      directive: {
        directive: "embedded",
        checkoutSessionId: SW_SESSION_ID,
        publishableKey: "pk_live_x",
      },
    });
    const controller = new WebCheckoutController(() => snapshot());

    const result = await controller.beginCheckout({ referenceName: "prefixed", mode: "sheet" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.productIdentifier).toBe("test:price_2:no-trial");
    expect(body.allowedCheckoutDirectives).toEqual(["embedded", "redirect"]);
    expect(body.context.presentment.presentedByEventId).toBeTruthy();
    expect(body.context.presentment.presentedByEventTimestamp).toBeTruthy();

    expect(result.directive).toBe("embedded");
    if (result.directive === "embedded") {
      expect(result.clientSecret).toBe(SECRET);
    }
  });

  it("requests only the redirect directive for external mode", async () => {
    const fetchMock = mockSession({
      checkoutContextId: "ctx_2",
      directive: { directive: "redirect", checkoutSessionId: "cs_1", checkoutUrl: "https://x" },
    });
    const controller = new WebCheckoutController(() => snapshot());

    await controller.beginCheckout({ referenceName: "monthly", mode: "external" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.allowedCheckoutDirectives).toEqual(["redirect"]);
  });

  it("prefetch is a silent no-op for store products", async () => {
    const fetchMock = mockSession({});
    const controller = new WebCheckoutController(() => snapshot());

    const result = await controller.prefetchCheckout({
      referenceName: "store_only",
      mode: "sheet",
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses the cached session instead of refetching", async () => {
    const fetchMock = mockSession({
      checkoutContextId: "ctx_3",
      directive: {
        directive: "embedded",
        checkoutSessionId: SW_SESSION_ID,
        publishableKey: "pk_live_x",
      },
    });
    const controller = new WebCheckoutController(() => snapshot());

    await controller.beginCheckout({ referenceName: "monthly", mode: "sheet" });
    await controller.beginCheckout({ referenceName: "monthly", mode: "sheet" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("openEmbeddedCheckout", () => {
  const session: SessionData = {
    directive: "embedded",
    checkoutSessionId: SW_SESSION_ID,
    clientSecret: SECRET,
    publishableKey: "pk_live_x",
    checkoutContextId: "ctx_1",
    referenceName: "monthly",
  };

  it("opens the sheet only after EMBEDDED_READY, then resolves on payment success", async () => {
    const opened: string[] = [];
    const unsubscribe = checkoutEvents.subscribe("SHEET_OPEN", ({ session: s }) => {
      opened.push(s.clientSecret);
    });

    const outcome = openEmbeddedCheckout(session);
    expect(opened).toEqual([]);

    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: SECRET });
    expect(opened).toEqual([SECRET]);

    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session });
    await expect(outcome).resolves.toEqual({ status: "completed" });
    unsubscribe();
  });

  it("resolves abandoned when the sheet closes after opening", async () => {
    const outcome = openEmbeddedCheckout(session);
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: SECRET });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    await expect(outcome).resolves.toEqual({ status: "abandoned" });
  });

  it("fails when Stripe never renders within the ready timeout", async () => {
    vi.useFakeTimers();
    const outcome = openEmbeddedCheckout(session);
    vi.advanceTimersByTime(20_000);
    await expect(outcome).resolves.toEqual({ status: "failed" });
  });
});

const embeddedDirective = {
  checkoutContextId: "ctx_embedded",
  directive: {
    directive: "embedded",
    checkoutSessionId: SW_SESSION_ID,
    publishableKey: "pk_test",
  },
};

const elementsDirective = {
  checkoutContextId: "ctx_quote",
  directive: {
    directive: "elements",
    checkoutSessionId: null,
    publishableKey: "pk_test",
    subscriptionDetails: {
      amount: 1999,
      amountDueNow: 1999,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      productName: "Premium",
    },
    paymentMethodTypes: ["card"],
    intentType: "PaymentIntent",
    stripeAccountCountryCode: "US",
    managementUrl: "https://example.superwall.app/manage",
  },
};

const requestBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string);

describe("Apple Pay quotes", () => {
  it("asks for the elements quote, deferred, in applePay mode", async () => {
    const fetchMock = mockSession(elementsDirective);
    const controller = new WebCheckoutController(snapshot);

    const result = await controller.beginCheckout({ referenceName: "monthly", mode: "applePay" });

    expect(requestBody(fetchMock)).toMatchObject({
      allowedCheckoutDirectives: ["elements", "embedded", "redirect"],
      deferElementsIntentCreation: true,
    });
    expect(result).toEqual({
      directive: "elements",
      checkoutSessionId: null,
      publishableKey: "pk_test",
      checkoutContextId: "ctx_quote",
      referenceName: "monthly",
      subscriptionDetails: elementsDirective.directive.subscriptionDetails,
      intentType: "PaymentIntent",
      stripeAccountCountryCode: "US",
      managementUrl: "https://example.superwall.app/manage",
    });
  });

  it("never asks for a quote in sheet mode", async () => {
    const fetchMock = mockSession(embeddedDirective);
    const controller = new WebCheckoutController(snapshot);
    await controller.beginCheckout({ referenceName: "monthly", mode: "sheet" });
    expect(requestBody(fetchMock)).toMatchObject({
      allowedCheckoutDirectives: ["embedded", "redirect"],
      deferElementsIntentCreation: false,
    });
  });

  it("keeps a deferred quote from a prefetch even though it has no Stripe object", async () => {
    mockSession(elementsDirective);
    const controller = new WebCheckoutController(snapshot);
    const result = await controller.prefetchCheckout({
      referenceName: "monthly",
      mode: "applePay",
    });
    expect(result?.directive).toBe("elements");
    expect(sessionCache.get("monthly", "default")?.directive).toBe("elements");
  });

  it("rejects a quote without the details the wallet needs", async () => {
    mockSession({
      checkoutContextId: "ctx",
      directive: { directive: "elements", publishableKey: "pk_test" },
    });
    const controller = new WebCheckoutController(snapshot);
    await expect(
      controller.beginCheckout({ referenceName: "monthly", mode: "applePay" }),
    ).rejects.toThrow(/subscriptionDetails/);
  });
});

/** Stubs fetch per URL fragment; a function value is called for a fresh Response each time. */
const stubFetch = (responses: Record<string, unknown | (() => Response)>) => {
  const fetchMock = vi.fn(async (url: string) => {
    const key = Object.keys(responses).find((candidate) => url.includes(candidate));
    const response = key ? responses[key] : undefined;
    if (typeof response === "function") return (response as () => Response)();
    return new Response(JSON.stringify(response ?? {}), { status: response ? 200 : 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("promotion codes", () => {
  const validation = {
    valid: true,
    discount: { code: "SAVE5", promotionCodeId: "promo_1", couponId: "c_1", duration: "once" },
    products: [
      {
        productIdentifier: "test:price_1:no-trial",
        applies: true,
        originalAmount: 1999,
        discountedAmount: 1499,
        currency: "usd",
      },
      {
        productIdentifier: "test:price_2:no-trial",
        applies: false,
        originalAmount: 999,
        discountedAmount: 999,
        currency: "usd",
      },
    ],
  };

  const twoProducts = () =>
    snapshot({
      products: [
        { reference: "monthly", productId: "test:price_1:no-trial" },
        { reference: "prefixed", productId: "stripe|test:price_2:no-trial" },
      ],
    });
  const storeOnly = () =>
    snapshot({ products: [{ reference: "store_only", productId: "pro_999_month" }] });

  it("validates against the paywall's Stripe products and applies to the ones it covers", async () => {
    const fetchMock = stubFetch({ "checkout/discount": validation });
    const controller = new WebCheckoutController(twoProducts);
    const changed = vi.fn();
    controller.subscribeDiscount(changed);

    const result = await controller.redeemDiscount(" SAVE5 ");

    expect(result.valid).toBe(true);
    expect(requestBody(fetchMock)).toEqual({
      code: "SAVE5",
      store: "stripe",
      productIdentifiers: ["test:price_1:no-trial", "test:price_2:no-trial"],
    });
    expect(controller.getAppliedDiscount()).toMatchObject({ code: "SAVE5" });
    expect(controller.getDiscountCodeForProduct("test:price_1:no-trial")).toBe("SAVE5");
    expect(controller.getDiscountCodeForProduct("stripe|test:price_1:no-trial")).toBe("SAVE5");
    expect(controller.getDiscountCodeForProduct("stripe|test:price_2:no-trial")).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("reports a code that applies to nothing, and applies nothing", async () => {
    stubFetch({
      "checkout/discount": {
        ...validation,
        products: validation.products.map((p) => ({ ...p, applies: false })),
      },
    });
    const controller = new WebCheckoutController(twoProducts);
    await expect(controller.redeemDiscount("SAVE5")).resolves.toEqual({
      valid: false,
      reason: "no_applicable_products",
    });
    expect(controller.getAppliedDiscount()).toBeNull();
  });

  it("passes the backend's verdict through for an unknown code", async () => {
    stubFetch({ "checkout/discount": { valid: false, reason: "code_not_found" } });
    const controller = new WebCheckoutController(twoProducts);
    await expect(controller.redeemDiscount("NOPE")).resolves.toEqual({
      valid: false,
      reason: "code_not_found",
    });
  });

  it("refuses to redeem on a paywall without Stripe products", async () => {
    const controller = new WebCheckoutController(storeOnly);
    await expect(controller.redeemDiscount("SAVE5")).resolves.toEqual({
      valid: false,
      reason: "no_stripe_products",
    });
  });

  it("sends the code only on sessions for products it applies to", async () => {
    const fetchMock = stubFetch({
      "checkout/discount": validation,
      "checkout/session": embeddedDirective,
    });
    const controller = new WebCheckoutController(twoProducts);
    await controller.redeemDiscount("SAVE5");

    await controller.beginCheckout({ referenceName: "monthly", mode: "sheet" });
    await controller.beginCheckout({ referenceName: "prefixed", mode: "sheet" });

    expect(requestBody(fetchMock, 1).promotionCode).toBe("SAVE5");
    expect(requestBody(fetchMock, 2).promotionCode).toBeUndefined();
  });

  it("drops a code the backend refuses at checkout, retries once, and says so", async () => {
    let sessionCalls = 0;
    const fetchMock = stubFetch({
      "checkout/discount": validation,
      "checkout/session": () =>
        sessionCalls++ === 0
          ? new Response("refused", { status: 400 })
          : new Response(JSON.stringify(embeddedDirective), { status: 200 }),
    });
    const controller = new WebCheckoutController(twoProducts);
    const dropped = vi.fn();
    controller.subscribeDiscountDropped(dropped);
    await controller.redeemDiscount("SAVE5");

    const result = await controller.beginCheckout({ referenceName: "monthly", mode: "sheet" });

    expect(result.directive).toBe("embedded");
    expect(requestBody(fetchMock, 1).promotionCode).toBe("SAVE5");
    expect(requestBody(fetchMock, 2).promotionCode).toBeUndefined();
    expect(dropped).toHaveBeenCalledWith("SAVE5");
    expect(controller.getAppliedDiscount()).toBeNull();
  });

  it("keeps the code when a session that never carried it is refused", async () => {
    stubFetch({
      "checkout/discount": validation,
      "checkout/session": () => new Response("refused", { status: 400 }),
    });
    const controller = new WebCheckoutController(twoProducts);
    const dropped = vi.fn();
    controller.subscribeDiscountDropped(dropped);
    await controller.redeemDiscount("SAVE5");

    await expect(
      controller.beginCheckout({ referenceName: "prefixed", mode: "sheet" }),
    ).rejects.toThrow(/Client error/);
    expect(dropped).not.toHaveBeenCalled();
    expect(controller.getAppliedDiscount()).toMatchObject({ code: "SAVE5" });
  });

  it("clears the code and the sessions quoted with it", async () => {
    stubFetch({ "checkout/discount": validation, "checkout/session": embeddedDirective });
    const controller = new WebCheckoutController(twoProducts);
    await controller.redeemDiscount("SAVE5");
    await controller.beginCheckout({ referenceName: "monthly", mode: "sheet" });
    expect(sessionCache.get("monthly")).not.toBeNull();

    controller.clearDiscount();

    expect(controller.getAppliedDiscount()).toBeNull();
    expect(controller.getDiscountCode()).toBeNull();
    expect(sessionCache.get("monthly")).toBeNull();
  });
});

describe("host lifecycle for the embedded sheet", () => {
  it("tells the SDK when the sheet opens, submits, and completes", async () => {
    const postMessage = vi.fn();
    const host = {
      session: {
        getSnapshot: () =>
          ({
            ...(snapshot() as object),
            paywall: { id: "1", identifier: "pw_1" },
            experiment: { experimentId: "e", variantId: "v_1" },
            params: { event_name: "campaign_trigger" },
          }) as never,
        postMessage,
      },
      referenceName: "monthly",
    };
    const session: SessionData = {
      directive: "embedded",
      checkoutSessionId: SW_SESSION_ID,
      clientSecret: SECRET,
      publishableKey: "pk_test",
      checkoutContextId: "ctx_1",
      referenceName: "monthly",
    };

    const outcome = openEmbeddedCheckout(session, host);
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: SECRET });
    checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session });
    await expect(outcome).resolves.toEqual({ status: "completed" });

    const names = postMessage.mock.calls.map(([message]) => message.event_name);
    expect(names).toEqual([
      "initiate_web_checkout",
      "stripe_checkout_start",
      "stripe_checkout_submit",
      "stripe_checkout_complete",
    ]);
    expect(postMessage.mock.calls[0]![0]).toMatchObject({
      checkout_context_id: "ctx_1",
      product_identifier: "test:price_1:no-trial",
      paywall_identifier: "pw_1",
      experiment_variant_id: "v_1",
      presented_by_event_name: "campaign_trigger",
      store: "STRIPE",
    });
    expect(postMessage.mock.calls[3]![0]).toMatchObject({ sw_checkout_id: SW_SESSION_ID });
  });

  it("reports an abandoned sheet", async () => {
    const postMessage = vi.fn();
    const host = { session: { getSnapshot: snapshot, postMessage }, referenceName: "monthly" };
    const session: SessionData = {
      directive: "embedded",
      checkoutSessionId: SW_SESSION_ID,
      clientSecret: SECRET,
      publishableKey: "pk_test",
      checkoutContextId: "ctx_1",
      referenceName: "monthly",
    };
    const outcome = openEmbeddedCheckout(session, host);
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: SECRET });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    await expect(outcome).resolves.toEqual({ status: "abandoned" });
    expect(postMessage.mock.calls.at(-1)![0].event_name).toBe("stripe_checkout_abandon");
  });
});
