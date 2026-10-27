import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { usePurchase, useSuperwallSession } from "../../src/hooks";
import { checkoutEvents } from "../../src/checkout/events";
import { applePayFor, sessionsFor } from "../../src/checkout/flow";
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
      scope: "default",
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
      scope: "default",
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
      await sessions.prefetch({ referenceName: "primary", mode: "external", silent: true });
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

  it("still sends the shopper to the hosted page inside an iOS app", async () => {
    const { result, sessions } = await renderCheckout("applePay", "iOS");
    const begin = vi.spyOn(sessions, "begin").mockResolvedValue(redirect);

    await act(async () => {
      await result.current.purchase.purchase("primary", { checkout: "sheet" });
    });

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "external",
      scope: "default",
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
    const unsubscribe = checkoutEvents.subscribe("SESSION_CREATED", (session) => {
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
    );
    expect(begin).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "completed" });
  });

  it("falls back to the embedded sheet when the wallet is unavailable", async () => {
    const { result, sessions } = await renderCheckout("applePay");
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "unavailable",
      reason: "apple_pay_not_available",
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
      reason: "no_apple_pay_quote",
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
      scope: "default",
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
