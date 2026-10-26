import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { checkoutEvents } from "../../src/checkout/events";
import {
  applePayFor,
  autoPrefetchTargets,
  sessionsFor,
  contextFor,
  openEmbeddedSheet,
  openHostedCheckout,
  prefetchSession,
  purchaseOnWeb,
  reportCompletedCheckout,
  reprefetch,
  resolutionOf,
  watchCompletedCheckouts,
  type PaywallSession,
} from "../../src/checkout/flow";
import type {
  ElementsCheckoutSession,
  EmbeddedCheckoutSession,
  RedirectCheckoutSession,
} from "../../src/checkout/types";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const stripeProduct = (reference: string, index: number) => ({
  reference,
  productId: `test:price_${index}:no-trial`,
  variables: {},
  source: "sdk" as const,
});

type SessionOverrides = {
  checkout?: SuperwallCheckoutConfig;
  teleport?: import("@superwall/runtime").SuperwallTeleportConfig;
  postPurchase?: import("@superwall/runtime").SuperwallPostPurchase;
  sdkVersionPadded?: string;
  publicApiKey?: string;
  references?: string[];
  store?: string[];
  paywall?: { id: string; identifier: string };
  experiment?: { experimentId: string; variantId: string };
  eventName?: unknown;
};

const fakeSession = ({
  checkout,
  teleport,
  postPurchase,
  sdkVersionPadded,
  publicApiKey = "pk_test",
  references = ["primary", "secondary"],
  store = [],
  paywall,
  experiment,
  eventName,
}: SessionOverrides = {}) => {
  const products = [
    ...references.map((reference, index) => stripeProduct(reference, index + 1)),
    ...store.map((reference) => ({
      reference,
      productId: "pro_999_month",
      variables: {},
      source: "sdk" as const,
    })),
  ];
  const postMessage = vi.fn();
  const session: PaywallSession = {
    getSnapshot: () =>
      ({
        device: { publicApiKey, ...(sdkVersionPadded ? { sdkVersionPadded } : {}) },
        user: {},
        params: eventName === undefined ? {} : { event_name: eventName },
        products,
        productsByReference: Object.fromEntries(
          products.map((product) => [product.reference, product]),
        ),
        introductoryOffer: { eligible: false },
        config: { checkout, postPurchase, teleport },
        paywall,
        experiment,
      }) as never,
    postMessage,
  };
  return { session, postMessage };
};

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

const quote: ElementsCheckoutSession = {
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test",
  checkoutContextId: "ctx_3",
  referenceName: "primary",
  subscriptionDetails: { amount: 1999, currency: "usd", interval: "month", intervalCount: 1 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sessionsFor", () => {
  it("keeps one controller per session and drops its sessions when a code is refused", () => {
    const { session } = fakeSession({ checkout: "sheet" });
    const controller = sessionsFor(session);
    expect(sessionsFor(session)).toBe(controller);

    const invalidated = vi.fn();
    const stop = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    const warm = vi.spyOn(controller, "prefetch").mockResolvedValue(null);
    controller.discounts.apply("SAVE5", { code: "SAVE5", promotionCodeId: "p", couponId: "c" }, []);
    controller.discounts.drop("SAVE5");
    stop();

    expect(invalidated).toHaveBeenCalledWith({ reason: "discount code dropped" });
    expect(warm).toHaveBeenCalledWith(
      expect.objectContaining({ referenceName: "primary", mode: "sheet" }),
    );
  });
});

describe("applePayFor", () => {
  it("keeps one wallet per paywall", () => {
    const { session } = fakeSession();
    const wallet = applePayFor(session);
    expect(applePayFor(session)).toBe(wallet);
    expect(applePayFor(fakeSession().session)).not.toBe(wallet);
  });

  it("reports no key at all when the host sent none", async () => {
    const { session } = fakeSession({ publicApiKey: "" });
    const controller = applePayFor(session);
    await controller.prepare(quote);
    expect(controller.availability("primary")).toEqual({
      status: "unavailable",
      reason: "missing_public_api_key",
    });
  });
});

describe("contextFor", () => {
  it("carries the paywall, variant and placement when the SDK sent them", () => {
    const { session } = fakeSession({
      paywall: { id: "1", identifier: "pw_1" },
      experiment: { experimentId: "e", variantId: "v_1" },
      eventName: "campaign_trigger",
    });
    expect(contextFor(session, "primary", "ctx_1")).toEqual({
      checkoutContextId: "ctx_1",
      productIdentifier: "test:price_1:no-trial",
      paywallIdentifier: "pw_1",
      experimentVariantId: "v_1",
      presentedByEventName: "campaign_trigger",
    });
  });

  it("leaves out what it does not know, including a product it cannot find", () => {
    const { session } = fakeSession({ eventName: 7 });
    expect(contextFor(session, "missing", "ctx_1")).toEqual({
      checkoutContextId: "ctx_1",
      productIdentifier: "",
      paywallIdentifier: undefined,
      experimentVariantId: undefined,
    });
  });
});

describe("autoPrefetchTargets", () => {
  it("warms nothing when prefetching is off or there is no Stripe product", () => {
    const off = fakeSession({ checkout: { mode: "sheet", prefetch: false } });
    expect(autoPrefetchTargets(off.session, "sheet")).toEqual([]);

    const storeOnly = fakeSession({ references: [], store: ["annual"] });
    expect(autoPrefetchTargets(storeOnly.session, "sheet")).toEqual([]);
  });

  it("warms the configured product, ignoring a name that is not a Stripe product here", () => {
    const configured = fakeSession({ checkout: { mode: "sheet", prefetch: "secondary" } });
    expect(autoPrefetchTargets(configured.session, "sheet")).toEqual(["secondary"]);

    const unknown = fakeSession({ checkout: { mode: "sheet", prefetch: "nope" } });
    expect(autoPrefetchTargets(unknown.session, "sheet")).toEqual(["primary"]);
  });

  it("warms every Stripe product for the wallet, preferred first and capped", () => {
    const many = fakeSession({
      checkout: { mode: "applePay", prefetch: "secondary" },
      references: Array.from({ length: 12 }, (_, index) => `p${index}`).concat("secondary"),
    });
    const targets = autoPrefetchTargets(many.session, "applePay");
    expect(targets[0]).toBe("secondary");
    expect(targets).toHaveLength(10);
  });
});

describe("reprefetch", () => {
  it("warms the hosted page too, and nothing without a public API key", () => {
    const external = fakeSession({ checkout: "external" });
    const warmExternal = vi
      .spyOn(sessionsFor(external.session), "prefetch")
      .mockResolvedValue(null);
    expect(reprefetch(external.session)).toBe(true);
    expect(warmExternal).toHaveBeenCalledWith(expect.objectContaining({ mode: "external" }));

    const keyless = fakeSession({ checkout: "sheet", publicApiKey: "" });
    const warmKeyless = vi.spyOn(sessionsFor(keyless.session), "prefetch");
    expect(reprefetch(keyless.session)).toBe(false);
    expect(warmKeyless).not.toHaveBeenCalled();
  });
});

describe("prefetchSession", () => {
  it("says nothing to the host when the warm-up produced nothing", async () => {
    const { session, postMessage } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(null);
    await prefetchSession(session, "primary", "sheet");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("reports a warmed session to the host and pools an embedded one", async () => {
    const { session, postMessage } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(embedded);
    const pooled = vi.fn();
    const stop = checkoutEvents.subscribe("SESSION_CREATED", pooled);

    await prefetchSession(session, "primary", "sheet");
    stop();

    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      event_name: "stripe_checkout_prefetch",
      product_identifier: "test:price_1:no-trial",
    });
    expect(pooled).toHaveBeenCalledWith(embedded);
  });

  it("keeps an elements quote out of the sheet's pool", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(quote);
    const pooled = vi.fn();
    const stop = checkoutEvents.subscribe("SESSION_CREATED", pooled);

    await prefetchSession(session, "primary", "sheet");
    stop();

    expect(pooled).not.toHaveBeenCalled();
  });

  it("prepares the wallet from an elements quote", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(quote);
    const prepare = vi.spyOn(applePayFor(session), "prepare").mockResolvedValue(undefined);

    await prefetchSession(session, "primary", "applePay");

    expect(prepare).toHaveBeenCalledWith(quote, {});
  });

  it("marks the wallet unavailable when preparing it throws", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(quote);
    const wallet = applePayFor(session);
    vi.spyOn(wallet, "prepare").mockRejectedValue(new Error("stripe down"));

    await prefetchSession(session, "primary", "applePay");

    expect(wallet.availability("primary")).toEqual({
      status: "unavailable",
      reason: "prepare_failed",
    });
  });

  it("marks the wallet unavailable when the backend quoted a sheet instead", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(embedded);
    const wallet = applePayFor(session);

    await prefetchSession(session, "primary", "applePay");

    expect(wallet.availability("primary")).toEqual({
      status: "unavailable",
      reason: "no_apple_pay_quote",
    });
  });
});

describe("openEmbeddedSheet", () => {
  it("ignores events from another session's sheet", async () => {
    const { session, postMessage } = fakeSession();
    const other = { ...embedded, clientSecret: "cs_other" };
    const outcome = openEmbeddedSheet(embedded, { paywall: session, referenceName: "primary" });

    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session: other });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: other });
    checkoutEvents.dispatch("PAYMENT_ERROR", { error: new Error("x"), session: other });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });

    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(postMessage.mock.calls.map(([message]) => message.event_name)).toEqual([
      "initiate_web_checkout",
      "stripe_checkout_start",
    ]);
  });

  it("reports a failed payment to the host", async () => {
    const { session, postMessage } = fakeSession();
    const outcome = openEmbeddedSheet(embedded, { paywall: session, referenceName: "primary" });

    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_ERROR", { error: new Error("declined"), session: embedded });

    await expect(outcome).resolves.toEqual({ status: "failed" });
    expect(postMessage.mock.calls.at(-1)?.[0].event_name).toBe("stripe_checkout_fail");
  });

  it("ignores a close that arrives before the sheet ever opened", async () => {
    vi.useFakeTimers();
    const outcome = openEmbeddedSheet(embedded);
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    vi.advanceTimersByTime(20_000);
    await expect(outcome).resolves.toEqual({ status: "failed" });
    vi.useRealTimers();
  });

  it("opens only once, however often Stripe reports it rendered", async () => {
    const opened = vi.fn();
    const stop = checkoutEvents.subscribe("SHEET_OPEN", opened);
    const outcome = openEmbeddedSheet(embedded);

    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });
    stop();

    await expect(outcome).resolves.toEqual({ status: "completed" });
    expect(opened).toHaveBeenCalledOnce();
  });
});

describe("purchaseOnWeb", () => {
  it("takes the wallet's outcome when the wallet could open", async () => {
    const { session } = fakeSession({ checkout: "applePay" });
    vi.spyOn(applePayFor(session), "purchase").mockResolvedValue({ status: "abandoned" });
    const begin = vi.spyOn(sessionsFor(session), "begin");

    await expect(purchaseOnWeb(session, "primary", "applePay")).resolves.toBe("abandoned");
    expect(begin).not.toHaveBeenCalled();
  });

  it("reuses an embedded session the wallet warm-up already produced", async () => {
    const { session } = fakeSession({ checkout: "applePay" });
    vi.spyOn(applePayFor(session), "purchase").mockResolvedValue({
      status: "unavailable",
      reason: "no_apple_pay_quote",
    });
    sessionsFor(session).cache.set("primary", embedded, "apple-pay");
    const begin = vi.spyOn(sessionsFor(session), "begin");

    const outcome = purchaseOnWeb(session, "primary", "applePay");
    await Promise.resolve();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);

    await expect(outcome).resolves.toBe("abandoned");
    expect(begin).not.toHaveBeenCalled();
  });

  it("sends a shopper to hosted checkout for a redirect directive", async () => {
    const { session } = fakeSession();
    vi.spyOn(sessionsFor(session), "begin").mockResolvedValue(redirect);
    await expect(purchaseOnWeb(session, "primary", "sheet")).resolves.toBe("abandoned");
    expect(window.location.hash).toBe("#hosted");
  });

  it("fails on a directive it cannot act on, and on a session it cannot create", async () => {
    const { session } = fakeSession();
    const controller = sessionsFor(session);
    vi.spyOn(controller, "begin").mockResolvedValue(JSON.parse('{ "directive": "unknown" }'));
    await expect(purchaseOnWeb(session, "primary", "sheet")).resolves.toBe("failed");

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(controller, "begin").mockRejectedValue(new Error("offline"));
    await expect(purchaseOnWeb(session, "primary", "sheet")).resolves.toBe("failed");
    expect(error).toHaveBeenCalledWith("Error beginning web checkout:", expect.any(Error));
  });

  it("asks the wallet with an empty context id when nothing was warmed", async () => {
    const { session } = fakeSession({ checkout: "applePay" });
    const wallet = vi
      .spyOn(applePayFor(session), "purchase")
      .mockResolvedValue({ status: "completed" });

    await purchaseOnWeb(session, "primary", "applePay");

    expect(wallet).toHaveBeenCalledWith(
      "primary",
      expect.objectContaining({ checkoutContextId: "" }),
    );
  });
});

describe("a host that never sent a public API key", () => {
  it("reads it as no key rather than the string undefined", async () => {
    const session: PaywallSession = {
      getSnapshot: () => ({ device: {}, user: {}, params: {}, products: [] }) as never,
      postMessage: vi.fn(),
    };
    const controller = applePayFor(session);
    await controller.prepare(quote);
    expect(controller.availability("primary")).toEqual({
      status: "unavailable",
      reason: "missing_public_api_key",
    });
  });
});

describe("reporting a completed purchase", () => {
  const paid: EmbeddedCheckoutSession = { ...embedded, postPurchaseBehavior: "GRANT_ACCESS" };

  it("tells the SDK what completed and what the backend said to do about it", async () => {
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "004.014.000" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await reportCompletedCheckout(session, paid);

    expect(postMessage).toHaveBeenCalledWith({
      event_name: "stripe_checkout_complete",
      sw_checkout_id: "sw_checkout_1",
      checkout_context_id: "ctx_1",
      product_identifier: "test:price_1:no-trial",
      post_purchase_behavior: "GRANT_ACCESS",
    });
    // An SDK from 4.14.0 redeems the purchase itself.
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("forgets the warmed sessions, so the next purchase never reopens a paid one", async () => {
    const { session } = fakeSession({ sdkVersionPadded: "004.014.000" });
    const sessions = sessionsFor(session);
    sessions.cache.set("primary", embedded);

    await reportCompletedCheckout(session, paid);

    expect(sessions.cache.get("primary")).toBeNull();
  });

  it("binds a purchase made on the web half of a teleport to it instead of redeeming it here", async () => {
    Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout" });
    try {
      const { session, postMessage } = fakeSession({
        sdkVersionPadded: "004.013.999",
        teleport: { route: "checkout" },
      });
      const fetchMock = vi.fn(async () => new Response("{}"));
      vi.stubGlobal("fetch", fetchMock);

      await reportCompletedCheckout(session, paid);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain("checkout/session/complete");
      expect(init.keepalive).toBe(true);
      expect(postMessage.mock.calls.map(([message]) => message.event_name)).toEqual([
        "stripe_checkout_complete",
      ]);
    } finally {
      Reflect.deleteProperty(window, "__SW_TELEPORT__");
      vi.unstubAllGlobals();
    }
  });

  it("redeems the purchase itself on an SDK too old to do it", async () => {
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "004.013.999" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ redemptionUrl: "myapp://redeem/abc" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await reportCompletedCheckout(session, embedded);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("checkout/session/complete");
    expect(JSON.parse(String(init.body))).toEqual({ checkoutContextId: "ctx_1" });
    expect(init.headers).toMatchObject({ Authorization: "Bearer pk_test" });
    expect(postMessage.mock.calls.at(-1)?.[0]).toEqual({
      event_name: "open_deep_link",
      link: "myapp://redeem/abc",
    });
    vi.unstubAllGlobals();
  });

  it("says so when the backend hands back no link, and when the call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}))),
    );
    const empty = fakeSession({ sdkVersionPadded: "004.013.999" });
    await reportCompletedCheckout(empty.session, embedded);
    expect(warn).toHaveBeenCalledWith("The checkout backend returned no redemption URL.");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const offline = fakeSession({ sdkVersionPadded: "004.013.999" });
    await reportCompletedCheckout(offline.session, embedded);
    expect(error).toHaveBeenCalledWith("Redeeming the web purchase failed:", expect.any(Error));

    expect(
      empty.postMessage.mock.calls.every(([message]) => message.event_name !== "open_deep_link"),
    ).toBe(true);
    vi.unstubAllGlobals();
  });

  it("cannot redeem without a public API key, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { session } = fakeSession({ sdkVersionPadded: "004.013.999", publicApiKey: "" });

    await reportCompletedCheckout(session, embedded);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Cannot redeem a web purchase: the host sent no public API key.",
    );
    vi.unstubAllGlobals();
  });

  it("reports every completion while the paywall is mounted, and none after", async () => {
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "004.014.000" });
    const stop = watchCompletedCheckouts(session);

    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });
    await flushMicrotasks();
    expect(postMessage.mock.calls.map(([message]) => message.event_name)).toEqual([
      "stripe_checkout_complete",
    ]);

    stop();
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });
    await flushMicrotasks();
    expect(postMessage).toHaveBeenCalledOnce();
  });
});

const COMPLETION = {
  entitlementsToken: "ent_1",
  claimed: true,
  redemptionCodes: [{ code: "redemption_1", claimed: true }],
};

describe("a checkout completed inside the Web SDK", () => {
  type Holder = typeof window & { webPaywallCtrl?: { props?: { clientSurface?: unknown } } };
  afterEach(() => {
    delete (window as Holder).webPaywallCtrl;
  });

  it("self-claims the redemption first and hands the SDK the entitlements token", async () => {
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-sdk" } };
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "004.014.000" });
    const claim = vi.spyOn(sessionsFor(session), "completeWebapp").mockResolvedValue(COMPLETION);
    vi.stubGlobal("fetch", vi.fn());

    await reportCompletedCheckout(session, { ...embedded, postPurchaseBehavior: "GRANT_ACCESS" });

    expect(claim).toHaveBeenCalledWith("ctx_1");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "stripe_checkout_complete",
        entitlements_token: "ent_1",
      }),
    );
    vi.unstubAllGlobals();
  });

  it("skips the claim for behaviors that do not bind the entitlement", async () => {
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-sdk" } };
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "004.014.000" });
    const claim = vi.spyOn(sessionsFor(session), "completeWebapp");
    vi.stubGlobal("fetch", vi.fn());

    await reportCompletedCheckout(session, { ...embedded, postPurchaseBehavior: "REDEEM" });

    expect(claim).not.toHaveBeenCalled();
    expect(postMessage.mock.calls[0]?.[0]).not.toHaveProperty("entitlements_token");
    vi.unstubAllGlobals();
  });

  it("hands its host the claim on stripe_checkout_complete and leaves the rest to it", async () => {
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-sdk" } };
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "000.002.009" });
    vi.spyOn(sessionsFor(session), "completeWebapp").mockResolvedValue(COMPLETION);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await reportCompletedCheckout(session, { ...embedded, postPurchaseBehavior: "GRANT_ACCESS" });

    expect(postMessage.mock.calls.map(([message]) => message.event_name)).toEqual([
      "stripe_checkout_complete",
    ]);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "stripe_checkout_complete",
        checkout_context_id: "ctx_1",
        post_purchase_behavior: "GRANT_ACCESS",
        claimed: true,
        redemption_codes: [{ code: "redemption_1", claimed: true }],
        entitlements_token: "ent_1",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("still tells the SDK when the claim fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-sdk" } };
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "004.014.000" });
    vi.spyOn(sessionsFor(session), "completeWebapp").mockRejectedValue(new Error("nope"));
    vi.stubGlobal("fetch", vi.fn());

    await reportCompletedCheckout(session, embedded);

    expect(error).toHaveBeenCalledWith(
      "Completing the Web SDK checkout failed:",
      expect.any(Error),
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "stripe_checkout_complete" }),
    );
    expect(postMessage.mock.calls[0]?.[0]).not.toHaveProperty("entitlements_token");
    vi.unstubAllGlobals();
  });
});

describe("resolutionOf", () => {
  it("maps the post-purchase choice to what the web host reads", () => {
    expect(resolutionOf(undefined)).toBeUndefined();
    expect(resolutionOf("dismiss")).toBeUndefined();
    expect(resolutionOf("stay")).toEqual({ type: "paywall" });
    expect(resolutionOf("redeem")).toEqual({ type: "redeem" });
    expect(resolutionOf({ redirect: "https://app.example.com/welcome" })).toEqual({
      type: "redirect",
      url: "https://app.example.com/welcome",
    });
  });
});

describe("post-purchase and metadata on a completed checkout", () => {
  it("carries the config's post-purchase resolution to the SDK", async () => {
    const { session, postMessage } = fakeSession({
      sdkVersionPadded: "004.014.000",
      postPurchase: "redeem",
    });
    vi.stubGlobal("fetch", vi.fn());

    await reportCompletedCheckout(session, embedded);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "stripe_checkout_complete",
        post_purchase_resolution: { type: "redeem" },
      }),
    );
    vi.unstubAllGlobals();
  });

  it("writes the purchase's metadata onto the Stripe object before the SDK acts", async () => {
    const { session } = fakeSession({ sdkVersionPadded: "004.014.000", checkout: "sheet" });
    const attach = vi.spyOn(sessionsFor(session), "attachMetadata").mockResolvedValue(undefined);
    vi.spyOn(sessionsFor(session), "begin").mockResolvedValue(embedded);
    vi.stubGlobal("fetch", vi.fn());
    const stop = watchCompletedCheckouts(session);

    const outcome = purchaseOnWeb(session, "primary", "sheet", {
      stripeMetadata: { quiz_session: "sess_1" },
    });
    // Let begin() resolve and openEmbeddedSheet subscribe before the sheet reports in.
    await flushMicrotasks();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });
    await expect(outcome).resolves.toBe("completed");
    await flushMicrotasks();

    expect(attach).toHaveBeenCalledWith("ctx_1", { quiz_session: "sess_1" });
    stop();
    vi.unstubAllGlobals();
  });

  it("keeps the purchase when writing metadata fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { session } = fakeSession({ sdkVersionPadded: "004.014.000", checkout: "sheet" });
    vi.spyOn(sessionsFor(session), "attachMetadata").mockRejectedValue(new Error("nope"));
    vi.spyOn(sessionsFor(session), "begin").mockResolvedValue(embedded);
    vi.stubGlobal("fetch", vi.fn());
    const stop = watchCompletedCheckouts(session);

    const outcome = purchaseOnWeb(session, "primary", "sheet", {
      stripeMetadata: { plan: "annual" },
    });
    await flushMicrotasks();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });
    await expect(outcome).resolves.toBe("completed");
    await flushMicrotasks();

    expect(error).toHaveBeenCalledWith("Attaching checkout metadata failed:", expect.any(Error));
    stop();
    vi.unstubAllGlobals();
  });
});

describe("an SDK that cannot host payment", () => {
  it("sends the shopper to the hosted page instead of opening a sheet", async () => {
    const { session } = fakeSession({ sdkVersionPadded: "004.009.000", checkout: "sheet" });
    const begin = vi.spyOn(sessionsFor(session), "begin").mockResolvedValue(redirect);

    await expect(purchaseOnWeb(session, "primary", "sheet")).resolves.toBe("abandoned");

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "external",
      scope: "external",
    });
    expect(window.location.hash).toBe("#hosted");
  });

  it("does not open the wallet either", async () => {
    const { session } = fakeSession({ sdkVersionPadded: "004.009.000", checkout: "applePay" });
    const wallet = vi.spyOn(applePayFor(session), "purchase");
    vi.spyOn(sessionsFor(session), "begin").mockResolvedValue(redirect);

    await purchaseOnWeb(session, "primary", "applePay");

    expect(wallet).not.toHaveBeenCalled();
  });

  it("warms the hosted page it will send the shopper to, not the sheet", () => {
    const { session } = fakeSession({ sdkVersionPadded: "004.009.000", checkout: "sheet" });
    const warm = vi.spyOn(sessionsFor(session), "prefetch").mockResolvedValue(null);
    reprefetch(session);
    expect(warm).toHaveBeenCalledWith(expect.objectContaining({ mode: "external" }));
  });
});

describe("a hosted checkout the shopper leaves the paywall for", () => {
  const nativeHost = () => {
    vi.stubGlobal("webkit", {
      messageHandlers: { paywallMessageHandler: { postMessage: vi.fn() } },
    });
  };

  const statuses = (...replies: unknown[]) => {
    const queue = [...replies];
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes("checkout/status")) return new Response(JSON.stringify({}));
      const reply = queue.length > 1 ? queue.shift() : queue[0];
      return new Response(JSON.stringify(reply));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks the SDK to open it, then watches the backend until it completes", async () => {
    nativeHost();
    vi.useFakeTimers();
    const fetchMock = statuses(
      { status: "pending" },
      { status: "completed", redemptionUrl: "myapp://redeem/abc" },
    );
    const { session, postMessage } = fakeSession({ sdkVersionPadded: "004.009.000" });

    const outcome = openHostedCheckout(session, redirect);
    expect(postMessage.mock.calls.map(([message]) => message.event_name)).toEqual([
      "initiate_web_checkout",
      "stripe_checkout_start",
      "open_url_external",
    ]);
    expect(postMessage.mock.calls[2]?.[0]).toMatchObject({ url: "#hosted" });

    await vi.advanceTimersByTimeAsync(4000);
    await expect(outcome).resolves.toBe("completed");

    expect(
      JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
    ).toEqual({
      checkoutId: "ctx_2",
    });
    const names = postMessage.mock.calls.map(([message]) => message.event_name);
    expect(names).toContain("stripe_checkout_complete");
    // The status already carried the link, so no second call to ask for one.
    expect(names.at(-1)).toBe("open_deep_link");
    expect(fetchMock.mock.calls.every(([url]) => url.includes("checkout/status"))).toBe(true);
  });

  it("resolves abandoned when the backend says the shopper walked away", async () => {
    nativeHost();
    vi.useFakeTimers();
    statuses({ status: "abandoned" });
    const { session, postMessage } = fakeSession();

    const outcome = openHostedCheckout(session, redirect);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(outcome).resolves.toBe("abandoned");
    expect(postMessage.mock.calls.map(([message]) => message.event_name)).not.toContain(
      "stripe_checkout_complete",
    );
  });

  it("gives up after two minutes of a checkout nobody finished", async () => {
    nativeHost();
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = statuses({ status: "pending" });
    const { session } = fakeSession();

    const outcome = openHostedCheckout(session, redirect);
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(outcome).resolves.toBe("abandoned");
    expect(fetchMock).toHaveBeenCalledTimes(60);
    expect(warn).toHaveBeenCalledWith("Gave up watching a hosted checkout after two minutes.");
  });

  it("keeps watching through a status call that fails", async () => {
    nativeHost();
    vi.useFakeTimers();
    let asked = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        asked++;
        if (asked === 1) throw new Error("offline");
        return new Response(JSON.stringify({ status: "completed" }));
      }),
    );
    const { session } = fakeSession({ sdkVersionPadded: "004.014.000" });

    const outcome = openHostedCheckout(session, redirect);
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(outcome).resolves.toBe("completed");
  });

  it("navigates the page itself when no SDK is hosting the paywall", async () => {
    const { session, postMessage } = fakeSession();
    await expect(openHostedCheckout(session, redirect)).resolves.toBe("abandoned");
    expect(window.location.hash).toBe("#hosted");
    expect(postMessage.mock.calls.map(([message]) => message.event_name)).toEqual([
      "initiate_web_checkout",
      "stripe_checkout_start",
    ]);
  });
});
