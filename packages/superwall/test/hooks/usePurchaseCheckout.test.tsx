import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { usePurchase, useSuperwallSession } from "../../src/hooks";
import { checkoutEvents, reportWebFailure } from "../../src/checkout/events";
import { applePayFor, sessionsFor } from "../../src/checkout/flow";
import { teleportFor } from "../../src/checkout/teleport/flow";
import type {
  ElementsCheckoutSession,
  EmbeddedCheckoutSession,
  RedirectCheckoutSession,
} from "../../src/checkout/types";
import { flush, renderWithProvider, testConfig } from "../helpers";

const products = [
  { reference: "primary", productId: "test:price_1:no-trial" },
  { reference: "secondary", productId: "pro_999_month" },
];

const embedded: EmbeddedCheckoutSession = {
  directive: "embedded",
  checkoutSessionId: "sw_checkout_1",
  clientSecret: "cs_test_secret",
  publishableKey: "pk_test",
  checkoutContextId: "ctx_1",
  referenceName: "primary",
};

const redirect: RedirectCheckoutSession = {
  directive: "redirect",
  checkoutSessionId: "sw_checkout_2",
  checkoutUrl: "#hosted-checkout",
  checkoutContextId: "ctx_2",
  referenceName: "primary",
};

const renderCheckout = async (
  checkout?: SuperwallCheckoutConfig,
  platform = "Android",
  publicApiKey = "pk_test",
) => {
  const outgoing: string[] = [];
  const rendered = renderWithProvider(
    () => ({ session: useSuperwallSession(), purchase: usePurchase() }),
    {
      config: { ...testConfig, checkout },
      host: {
        products,
        device: { platform, publicApiKey },
        onOutgoing: (message) => outgoing.push(message.event_name),
      },
    },
  );
  await flush();
  const session = rendered.result.current.session;
  const [product] = session.getSnapshot().products;
  if (!product) throw new Error("the mock host delivered no products");
  return { ...rendered, sessions: sessionsFor(session), product, outgoing };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePurchase with a Stripe product inside an iOS app", () => {
  it("sends the shopper to the hosted page even when the paywall asks for the sheet", async () => {
    const { result, sessions, outgoing } = await renderCheckout("sheet", "iOS");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "external",
      scope: "external",
    });
    expect(outgoing).toContain("initiate_web_checkout");
    expect(window.location.hash).toBe("#hosted-checkout");
    expect(outcome).toMatchObject({ status: "abandoned" });
  });

  it("buys it on the web when the paywall configures no checkout at all, never through the store", async () => {
    const { result, sessions } = await renderCheckout(undefined, "iOS");
    const begin = vi.spyOn(sessions, "begin").mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "external",
      scope: "external",
    });
    expect(outcome).toMatchObject({ status: "failed" });
    expect(result.current.purchase.transaction).toBeUndefined();
  });

  it("warms the hosted page for the product on selection, never the sheet", async () => {
    const { result, sessions } = await renderCheckout("sheet", "iOS");
    const prefetch = vi.spyOn(sessions, "prefetch").mockResolvedValue(null);

    act(() => result.current.purchase.prefetch("primary"));

    expect(prefetch).toHaveBeenCalledWith(
      expect.objectContaining({ referenceName: "primary", mode: "external" }),
    );
  });

  it("opens the session warmed for that product, and the same one again on the next tap", async () => {
    const { result, sessions } = await renderCheckout("sheet", "iOS");
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            checkoutContextId: "ctx_9",
            directive: {
              directive: "redirect",
              checkoutSessionId: "sw_checkout_9",
              checkoutUrl: "#warm",
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = () =>
      fetchMock.mock.calls.filter(([, init]) => String(init?.body).includes('"isPrefetch":false'));
    await act(async () => {
      await sessions.prefetch({
        referenceName: "primary",
        mode: "external",
        scope: "external",
        silent: true,
      });
    });

    for (let tap = 0; tap < 2; tap++) {
      await act(async () => {
        await result.current.purchase.purchase("primary");
      });
      expect(window.location.hash).toBe("#warm");
      window.location.hash = "";
    }
    expect(created()).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("a purchase that picks its own checkout mode", () => {
  it("opens the sheet for this call on a paywall whose default is Apple Pay", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    const wallet = vi.spyOn(applePayFor(result.current.session), "purchase");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(embedded);

    let outcome: Promise<{ status: string }> | undefined;
    act(() => {
      outcome = result.current.purchase.purchase("primary", { checkout: "sheet" });
    });
    await flush();

    expect(wallet).not.toHaveBeenCalled();
    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      scope: "default",
    });
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    await expect(outcome).resolves.toMatchObject({ status: "abandoned" });
  });

  it("never reuses a session warmed for another mode", async () => {
    const { result, sessions } = await renderCheckout("sheet");
    const directives: Record<string, unknown> = {
      embedded: {
        directive: "embedded",
        checkoutSessionId: "sw_checkout_sheet",
        clientSecret: "cs_sheet",
        publishableKey: "pk_test",
      },
      redirect: {
        directive: "redirect",
        checkoutSessionId: "sw_checkout_page",
        checkoutUrl: "#hosted-page",
      },
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body: unknown = JSON.parse(String(init?.body));
      const allowed = Reflect.get(Object(body), "allowedCheckoutDirectives");
      const directive =
        Array.isArray(allowed) && allowed[0] === "redirect" ? "redirect" : "embedded";
      return new Response(
        JSON.stringify({ checkoutContextId: `ctx_${directive}`, directive: directives[directive] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      await sessions.prefetch({ referenceName: "primary", mode: "sheet", silent: true });
    });
    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary", { checkout: "external" });
    });

    expect(window.location.hash).toBe("#hosted-page");
    expect(outcome).toMatchObject({ status: "abandoned" });
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("still sends the shopper to the hosted page inside an iOS app", async () => {
    const { result, sessions } = await renderCheckout("applePay", "iOS");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    await act(async () => {
      await result.current.purchase.purchase("primary", { checkout: "sheet" });
    });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "external",
      scope: "external",
    });
  });

  it("warms the mode the button will use, under the same iOS rule", async () => {
    const android = await renderCheckout("applePay");
    const warmAndroid = vi.spyOn(android.sessions, "prefetch").mockResolvedValue(null);
    act(() => android.result.current.purchase.prefetch("primary", { checkout: "sheet" }));
    expect(warmAndroid).toHaveBeenCalledWith(
      expect.objectContaining({ referenceName: "primary", mode: "sheet", scope: "default" }),
    );

    const ios = await renderCheckout("applePay", "iOS");
    const warmIos = vi.spyOn(ios.sessions, "prefetch").mockResolvedValue(null);
    act(() => ios.result.current.purchase.prefetch("primary", { checkout: "sheet" }));
    expect(warmIos).toHaveBeenCalledWith(expect.objectContaining({ mode: "external" }));
  });
});

describe("a purchase that sets its own prepaid-card rule", () => {
  it("blocks prepaid cards for this call, never reusing a session warmed under the config", async () => {
    const { result, sessions } = await renderCheckout("external");
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            checkoutContextId: "ctx_page",
            directive: {
              directive: "redirect",
              checkoutSessionId: "sw_checkout_page",
              checkoutUrl: "#hosted-page",
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      await sessions.prefetch({ referenceName: "primary", mode: "external", scope: "external" });
    });
    await act(async () => {
      await result.current.purchase.purchase("primary", { prepaidCards: "block" });
    });

    const blocked = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("checkout/session"))
      .map(([, init]) => JSON.parse(String(init?.body)).context.blockPrepaidCards);
    expect(blocked.at(-1)).toBe(true);
    expect(blocked.slice(0, -1)).not.toContain(true);
    expect(blocked.length).toBeGreaterThan(1);
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("takes the rule the app's tap carried to a teleport page, unless the page's call sets its own", async () => {
    Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout" });
    window.location.hash = "#ref=primary&p=block";
    const blockedFor = async (options?: { prepaidCards: "allow" | "block" }) => {
      const { result } = await renderCheckout("external");
      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              checkoutContextId: "ctx_page",
              directive: {
                directive: "redirect",
                checkoutSessionId: "sw_checkout_page",
                checkoutUrl: "#hosted-page",
              },
            }),
          ),
      );
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => {
        await result.current.purchase.purchase("primary", options);
      });
      vi.unstubAllGlobals();
      return fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith("checkout/session"))
        .map(([, init]) => JSON.parse(String(init?.body)).context.blockPrepaidCards)
        .at(-1);
    };

    try {
      expect(await blockedFor()).toBe(true);
      window.location.hash = "#ref=primary&p=block";
      expect(await blockedFor({ prepaidCards: "allow" })).toBeUndefined();
    } finally {
      Reflect.deleteProperty(window, "__SW_TELEPORT__");
      window.location.hash = "";
    }
  });

  it("allows them for this call on a paywall that blocks them", async () => {
    const { result, sessions } = await renderCheckout({ mode: "sheet", prepaidCards: "block" });
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    await act(async () => {
      await result.current.purchase.purchase("primary", { prepaidCards: "allow" });
    });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      scope: "default",
      prepaidCards: "allow",
    });
    window.location.hash = "";
  });

  it("skips the wallet warm-up's sheet when the call's rule differs from the config", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "unavailable",
      reason: "session_unsupported",
    });
    sessions.cache.set("primary", embedded, "apple-pay");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    await act(async () => {
      await result.current.purchase.purchase("primary", { prepaidCards: "block" });
    });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      scope: "default",
      prepaidCards: "block",
    });
    window.location.hash = "";
  });

  it("warms a session under the rule the button will use", async () => {
    const { result, sessions } = await renderCheckout("sheet");
    const prefetch = vi.spyOn(sessions, "prefetch").mockResolvedValue(null);

    act(() => result.current.purchase.prefetch("primary", { prepaidCards: "block" }));

    expect(prefetch).toHaveBeenCalledWith(
      expect.objectContaining({ referenceName: "primary", prepaidCards: "block" }),
    );
  });
});

describe("usePurchase with web checkout", () => {
  it("opens the embedded sheet for a Stripe product and resolves with its outcome", async () => {
    const { result, sessions } = await renderCheckout("sheet");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(embedded);

    let outcome: Promise<{ status: string }> | undefined;
    act(() => {
      outcome = result.current.purchase.purchase("primary");
    });
    await flush();

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      scope: "default",
    });

    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });

    await expect(outcome).resolves.toMatchObject({ status: "completed" });
  });

  it("follows a redirect directive and reports the purchase as abandoned", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    // Nothing was prepared for the wallet, so the purchase takes the sheet's
    // own session rather than the wallet's quote.
    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      scope: "default",
    });
    expect(window.location.hash).toBe("#hosted-checkout");
    expect(outcome).toMatchObject({ status: "abandoned" });
  });

  it("fails on a directive it cannot act on", async () => {
    const { result, sessions, product } = await renderCheckout("sheet");
    vi.spyOn(sessions, "begin").mockImplementation(() =>
      Promise.resolve(JSON.parse('{ "directive": "unknown" }')),
    );

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase(product);
    });

    expect(outcome).toMatchObject({ status: "failed" });
  });

  it("never throws when the session cannot be created", async () => {
    const { result, sessions } = await renderCheckout("sheet");
    vi.spyOn(sessions, "begin").mockRejectedValue(new Error("network down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "failed" });
    expect(error).toHaveBeenCalledWith("Error beginning web checkout:", expect.any(Error));
  });

  it("hands store products to the native purchase flow even with web checkout on", async () => {
    const { result, sessions } = await renderCheckout("sheet");
    const begin = vi.spyOn(sessions, "begin");

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("secondary");
    });
    await flush();

    expect(begin).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "completed" });
    expect(result.current.purchase.transaction?.product.reference).toBe("secondary");
  });
});

describe("usePurchase prefetch", () => {
  it("warms the first product by default", async () => {
    const { result, sessions } = await renderCheckout("sheet");
    const warm = vi.spyOn(sessions, "prefetch").mockResolvedValue(null);

    act(() => result.current.purchase.prefetch());

    expect(warm).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      scope: "default",
      silent: true,
    });
  });

  it("accepts a reference or a product and pools an embedded session", async () => {
    const { result, sessions, product } = await renderCheckout("applePay");
    const warm = vi.spyOn(sessions, "prefetch").mockResolvedValue(embedded);
    const pooled: string[] = [];
    const unsubscribe = checkoutEvents.subscribe("SESSION_PREFETCHED", (session) => {
      pooled.push(session.clientSecret);
    });

    act(() => result.current.purchase.prefetch("primary"));
    act(() => result.current.purchase.prefetch(product));
    await flush();

    expect(warm).toHaveBeenCalledTimes(2);
    expect(warm).toHaveBeenLastCalledWith({
      referenceName: "primary",
      mode: "applePay",
      scope: "apple-pay",
      silent: true,
    });
    expect(pooled).toEqual([embedded.clientSecret, embedded.clientSecret]);
    unsubscribe();
  });

  it("does nothing for store products, or without a public API key", async () => {
    const sheet = await renderCheckout("sheet");
    const sheetWarm = vi.spyOn(sheet.sessions, "prefetch");
    act(() => sheet.result.current.purchase.prefetch("secondary"));
    expect(sheetWarm).not.toHaveBeenCalled();

    const keyless = await renderCheckout("external", "Android", "");
    const keylessWarm = vi.spyOn(keyless.sessions, "prefetch");
    act(() => keyless.result.current.purchase.prefetch());
    expect(keylessWarm).not.toHaveBeenCalled();
  });
});

describe("usePurchase with Apple Pay", () => {
  it("opens the wallet for a Stripe product and resolves with its outcome", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    const session = result.current.session;
    const wallet = vi
      .spyOn(applePayFor(session), "purchase")
      .mockResolvedValue({ status: "completed" });
    const begin = vi.spyOn(sessions, "begin");

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(wallet).toHaveBeenCalledWith(
      "primary",
      expect.objectContaining({ productIdentifier: "test:price_1:no-trial" }),
      expect.any(Function),
    );
    expect(begin).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "completed" });
  });

  it("falls back to the embedded sheet when the wallet is unavailable", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "unavailable",
      reason: "stripe_declined",
    });
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(embedded);

    let outcome: Promise<{ status: string }> | undefined;
    act(() => {
      outcome = result.current.purchase.purchase("primary");
    });
    await flush();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      scope: "default",
    });
    await expect(outcome).resolves.toMatchObject({ status: "completed" });
  });

  it("reuses an embedded session the wallet warm-up already produced", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "unavailable",
      reason: "session_unsupported",
    });
    sessions.cache.set("primary", embedded, "apple-pay");
    const begin = vi.spyOn(sessions, "begin");

    let outcome: Promise<{ status: string }> | undefined;
    act(() => {
      outcome = result.current.purchase.purchase("primary");
    });
    await flush();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);

    expect(begin).not.toHaveBeenCalled();
    await expect(outcome).resolves.toMatchObject({ status: "abandoned" });
  });

  it("prepares the wallet from a prefetched quote", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    const quote: ElementsCheckoutSession = {
      directive: "elements",
      checkoutSessionId: null,
      publishableKey: "pk_test",
      checkoutContextId: "ctx_quote",
      referenceName: "primary",
      subscriptionDetails: {
        amount: 1999,
        currency: "usd",
        interval: "month",
        intervalCount: 1,
      },
    };
    vi.spyOn(sessions, "prefetch").mockResolvedValue(quote);
    const prepare = vi
      .spyOn(applePayFor(result.current.session), "prepare")
      .mockResolvedValue(undefined);

    await act(async () => {
      result.current.purchase.prefetch("primary");
      await flush();
    });

    expect(prepare).toHaveBeenCalledWith(quote, expect.any(Object));
  });
});

describe("usePurchase with hosted checkout", () => {
  it("sends a Stripe product to the web even though the sheet is not bundled", async () => {
    const { result, sessions } = await renderCheckout("external");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "external",
      scope: "external",
    });
    expect(outcome).toMatchObject({ status: "abandoned" });
  });

  it("still sends a store product to the SDK", async () => {
    const { result, sessions } = await renderCheckout("external");
    const begin = vi.spyOn(sessions, "begin");

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("secondary");
    });

    expect(begin).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "completed" });
  });
});

describe("usePurchase when a web payment fails", () => {
  const declined = {
    status: "failed" as const,
    failure: {
      reason: "insufficient_funds" as const,
      store: "stripe" as const,
      code: "card_declined",
      declineCode: "insufficient_funds",
    },
  };

  it("resolves with why it failed, and holds it until the next purchase starts", async () => {
    const { result } = await renderCheckout("applePay");
    const wallet = vi
      .spyOn(applePayFor(result.current.session), "purchase")
      .mockResolvedValue(declined);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(outcome).toMatchObject({ ...declined, product: { reference: "primary" } });
    expect(result.current.purchase.failure).toMatchObject({
      status: "failed",
      reason: "insufficient_funds",
      store: "stripe",
      code: "card_declined",
      declineCode: "insufficient_funds",
      product: { reference: "primary" },
    });

    let pay: ((outcome: { status: "completed" }) => void) | undefined;
    wallet.mockReturnValue(new Promise((resolve) => (pay = resolve)));
    let next: Promise<unknown> | undefined;
    act(() => {
      next = result.current.purchase.purchase("primary");
    });
    expect(result.current.purchase.failure).toBeUndefined();
    await act(async () => {
      pay?.({ status: "completed" });
      await next;
    });
    expect(result.current.purchase.failure).toBeUndefined();
  });

  it("drops a store purchase's failure when a web purchase starts, and keeps it gone once paid", async () => {
    const { result } = renderWithProvider(
      () => ({ session: useSuperwallSession(), purchase: usePurchase() }),
      {
        config: { ...testConfig, checkout: "applePay" },
        host: {
          products,
          device: { platform: "Android", publicApiKey: "pk_test" },
          purchase: "failed",
        },
      },
    );
    await flush();
    await act(async () => {
      await result.current.purchase.purchase("secondary");
    });
    expect(result.current.purchase.failure).toMatchObject({ product: { reference: "secondary" } });

    let pay: ((outcome: { status: "completed" }) => void) | undefined;
    vi.spyOn(applePayFor(result.current.session), "purchase").mockReturnValue(
      new Promise((resolve) => (pay = resolve)),
    );
    let next: Promise<unknown> | undefined;
    act(() => {
      next = result.current.purchase.purchase("primary");
    });
    expect(result.current.purchase.failure).toBeUndefined();
    await act(async () => {
      pay?.({ status: "completed" });
      await next;
    });
    expect(result.current.purchase.failure).toBeUndefined();
  });

  it("drops a web failure when a store purchase starts", async () => {
    const { result } = await renderCheckout("applePay");
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue(declined);
    await act(async () => {
      await result.current.purchase.purchase("primary");
    });
    expect(result.current.purchase.failure).toMatchObject({ reason: "insufficient_funds" });

    act(() => {
      void result.current.purchase.purchase("secondary");
    });
    expect(result.current.purchase.failure).not.toMatchObject({ reason: "insufficient_funds" });
  });

  it("drops a web failure when a custom store purchase starts", async () => {
    type Holder = typeof window & { webPaywallCtrl?: { props?: { clientSurface?: unknown } } };
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-direct" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    try {
      const rendered = renderWithProvider(
        () => ({ session: useSuperwallSession(), purchase: usePurchase() }),
        {
          config: { ...testConfig, checkout: "applePay" },
          host: {
            products: [...products, { reference: "custom", productId: "custom|gold" }],
            device: { platform: "Android", publicApiKey: "pk_test" },
          },
        },
      );
      await flush();
      const { result } = rendered;
      vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue(declined);
      await act(async () => {
        await result.current.purchase.purchase("primary");
      });
      expect(result.current.purchase.failure).toMatchObject({ reason: "insufficient_funds" });

      act(() => {
        void result.current.purchase.purchase("custom");
      });
      expect(result.current.purchase.failure).toBeUndefined();
    } finally {
      delete (window as Holder).webPaywallCtrl;
      vi.unstubAllGlobals();
    }
  });
});

describe("usePurchase callbacks", () => {
  const renderWithCallbacks = async (checkout: SuperwallCheckoutConfig) => {
    const calls: unknown[][] = [];
    const record =
      (name: string) =>
      (value: unknown): void => {
        calls.push([name, value]);
      };
    const rendered = renderWithProvider(
      () => ({
        session: useSuperwallSession(),
        buyer: usePurchase(),
        watcher: usePurchase({
          onStart: (product) => record("start")(product.reference),
          onSubmit: (product) => record("submit")(product.reference),
          onComplete: (product) => record("complete")(product.reference),
          onAbandon: (product) => record("abandon")(product.reference),
          onFailure: record("failure"),
        }),
      }),
      {
        config: { ...testConfig, checkout },
        host: { products, device: { platform: "Android", publicApiKey: "pk_test" } },
      },
    );
    await flush();
    return { ...rendered, sessions: sessionsFor(rendered.result.current.session), calls };
  };

  it("start, submit and complete for the sheet, on a hook that did not start the purchase", async () => {
    const { result, sessions, calls } = await renderWithCallbacks("sheet");
    vi.spyOn(sessions, "begin").mockResolvedValue(embedded);

    let outcome: Promise<unknown> | undefined;
    act(() => {
      outcome = result.current.buyer.purchase("primary");
    });
    await flush();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("CHECKOUT_SUBMITTED", {
      session: { ...embedded, clientSecret: "cs_another_paywall" },
    });
    checkoutEvents.dispatch("CHECKOUT_SUBMITTED", { session: embedded });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });
    await act(async () => {
      await outcome;
    });

    expect(calls).toEqual([
      ["start", "primary"],
      ["submit", "primary"],
      ["complete", "primary"],
    ]);
  });

  it("fires the end of a teleport handed to an in-app purchase once, from that purchase", async () => {
    const { result, calls } = await renderWithCallbacks("sheet");
    const teleporter = teleportFor(result.current.session);
    if (teleporter.kind !== "app") throw new Error("expected the app half");
    const bought = result.current.session.getSnapshot().productsByReference.secondary;
    vi.spyOn(teleporter, "available").mockReturnValue(true);
    vi.spyOn(teleporter, "begin").mockResolvedValue({
      reference: "secondary",
      result: Promise.resolve({ status: "failed", product: bought, reason: "superseded" }),
      reported: true,
    });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.buyer.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "failed", reason: "superseded" });
    expect(calls).toEqual([["start", "primary"]]);
  });

  it("fires the end of a teleport paid in the app through the store, with the store's reason", async () => {
    const { result, calls } = await renderWithCallbacks("sheet");
    const teleporter = teleportFor(result.current.session);
    if (teleporter.kind !== "app") throw new Error("expected the app half");
    const bought = result.current.session.getSnapshot().productsByReference.secondary;
    vi.spyOn(teleporter, "available").mockReturnValue(true);
    vi.spyOn(teleporter, "begin").mockResolvedValue({
      reference: "secondary",
      result: Promise.resolve({ status: "completed", product: bought }),
    });

    await act(async () => {
      await result.current.buyer.purchase("primary");
    });

    expect(calls).toEqual([
      ["start", "primary"],
      ["complete", "secondary"],
    ]);
  });

  it("settles a teleport the shopper gave up on after a decline as failed, with the decline", async () => {
    const { result, calls } = await renderWithCallbacks("sheet");
    const session = result.current.session;
    const teleporter = teleportFor(session);
    if (teleporter.kind !== "app") throw new Error("expected the app half");
    const failure = {
      reason: "insufficient_funds" as const,
      store: "stripe" as const,
      declineCode: "insufficient_funds",
    };
    vi.spyOn(teleporter, "available").mockReturnValue(true);
    vi.spyOn(teleporter, "begin").mockImplementation(async (request) => {
      reportWebFailure(session, { referenceName: "primary", failure, attempt: request.attempt });
      return "abandoned";
    });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.buyer.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "failed", failure });
    expect(result.current.buyer.failure).toMatchObject({ ...failure, status: "failed" });
    expect(calls.map(([name]) => name)).toEqual(["start", "failure"]);
  });

  const declineInSheet = async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "pending",
              failure: { code: "card_declined", declineCode: "insufficient_funds" },
            }),
          ),
      ),
    );
    const rendered = await renderWithCallbacks("sheet");
    vi.spyOn(rendered.sessions, "begin").mockResolvedValue(embedded);
    let settled = false;
    let outcome: Promise<unknown> | undefined;
    act(() => {
      outcome = rendered.result.current.buyer.purchase("primary").finally(() => {
        settled = true;
      });
    });
    await flush();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_ERROR", { error: new Error("declined"), session: embedded });
    await act(async () => {
      await flush();
    });
    return { ...rendered, outcome: () => outcome, settled: () => settled };
  };

  it("failure while a declined sheet stays open, then complete when the retry is paid", async () => {
    const { result, calls, outcome, settled } = await declineInSheet();
    try {
      expect(settled()).toBe(false);
      expect(calls).toEqual([
        ["start", "primary"],
        [
          "failure",
          expect.objectContaining({
            reason: "insufficient_funds",
            product: expect.objectContaining({ reference: "primary" }),
          }),
        ],
      ]);
      expect(result.current.buyer.failure).toMatchObject({ reason: "insufficient_funds" });

      checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });
      await act(async () => {
        await expect(outcome()).resolves.toMatchObject({ status: "completed" });
      });
      expect(calls.at(-1)).toEqual(["complete", "primary"]);
      expect(calls.filter(([name]) => name === "failure")).toHaveLength(1);
      expect(result.current.buyer.failure).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("settles failed with why once a declined sheet is closed, calling back only once", async () => {
    const { calls, outcome } = await declineInSheet();
    try {
      checkoutEvents.dispatch("SHEET_CLOSE", undefined);
      await act(async () => {
        await expect(outcome()).resolves.toMatchObject({
          status: "failed",
          failure: { reason: "insufficient_funds" },
        });
      });
      expect(calls.map(([name]) => name)).toEqual(["start", "failure"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("calls back each of two declines once, when their lookups end out of order and the sheet closes", async () => {
    const answers: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("checkout/status")
          ? new Promise<Response>((resolve) => answers.push(resolve))
          : Promise.resolve(new Response(JSON.stringify({ status: "pending" }))),
      ),
    );
    try {
      const rendered = await renderWithCallbacks("sheet");
      vi.spyOn(rendered.sessions, "begin").mockResolvedValue(embedded);
      let outcome: Promise<unknown> | undefined;
      act(() => {
        outcome = rendered.result.current.buyer.purchase("primary");
      });
      await flush();
      checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
      checkoutEvents.dispatch("PAYMENT_ERROR", { error: new Error("declined"), session: embedded });
      checkoutEvents.dispatch("PAYMENT_ERROR", { error: new Error("declined"), session: embedded });
      await vi.waitFor(() => expect(answers).toHaveLength(2));
      const declined = (declineCode: string) =>
        new Response(
          JSON.stringify({ status: "pending", failure: { code: "card_declined", declineCode } }),
        );
      await act(async () => {
        answers[1]?.(declined("insufficient_funds"));
        await flush();
        answers[0]?.(declined("expired_card"));
        await flush();
      });
      checkoutEvents.dispatch("SHEET_CLOSE", undefined);
      await act(async () => {
        await expect(outcome).resolves.toMatchObject({
          status: "failed",
          failure: { reason: "insufficient_funds" },
        });
      });
      const failures = rendered.calls.filter(([name]) => name === "failure");
      expect(failures.map(([, failure]) => (failure as { reason: string }).reason)).toEqual([
        "expired_card",
        "insufficient_funds",
      ]);
      expect(rendered.result.current.buyer.failure).toMatchObject({ reason: "insufficient_funds" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("failure with the product and why, when Apple Pay is declined", async () => {
    const { result, calls } = await renderWithCallbacks("applePay");
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "failed",
      failure: { reason: "expired_card", store: "stripe", code: "expired_card" },
    });

    await act(async () => {
      await result.current.buyer.purchase("primary");
    });

    expect(calls).toEqual([
      ["start", "primary"],
      [
        "failure",
        {
          status: "failed",
          reason: "expired_card",
          store: "stripe",
          code: "expired_card",
          product: expect.objectContaining({ reference: "primary" }),
        },
      ],
    ]);
  });

  it("abandon when the hosted checkout ends unpaid, then a store product's own start and end", async () => {
    const { result, sessions, calls } = await renderWithCallbacks("sheet");
    vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    await act(async () => {
      await result.current.buyer.purchase("primary");
      await result.current.buyer.purchase("secondary");
    });

    expect(calls).toEqual([
      ["start", "primary"],
      ["abandon", "primary"],
      ["start", "secondary"],
      ["complete", "secondary"],
    ]);
  });

  it("fires a purchase() call's own failure for a declined sheet, beside the hook's", async () => {
    const own: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "pending", failure: { code: "expired_card" } })),
      ),
    );
    try {
      const { result, sessions, calls } = await renderWithCallbacks("sheet");
      vi.spyOn(sessions, "begin").mockResolvedValue(embedded);
      let outcome: Promise<unknown> | undefined;
      act(() => {
        outcome = result.current.buyer.purchase("primary", {
          onFailure: (failure) => own.push(failure.reason),
        });
      });
      await flush();
      checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
      checkoutEvents.dispatch("PAYMENT_ERROR", { error: new Error("declined"), session: embedded });
      await act(async () => {
        await flush();
      });
      checkoutEvents.dispatch("SHEET_CLOSE", undefined);
      await act(async () => {
        await outcome;
      });

      expect(own).toEqual(["expired_card"]);
      expect(calls.map(([name]) => name)).toEqual(["start", "failure"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops calling back once the hook unmounts", async () => {
    const { result, sessions, calls, unmount } = await renderWithCallbacks("sheet");
    vi.spyOn(sessions, "begin").mockResolvedValue(redirect);
    const { purchase } = result.current.buyer;
    unmount();

    await act(async () => {
      await purchase("primary");
    });

    expect(calls).toEqual([]);
  });
});
