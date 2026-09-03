import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { usePurchase, useSuperwallSession } from "../../src/hooks";
import { checkoutEvents } from "../../src/checkout/services/CheckoutEvents";
import { applePayControllerFor, controllerFor } from "../../src/checkout/services/registry";
import { sessionCache } from "../../src/checkout/services/SessionCache";
import type {
  ElementsCheckoutSession,
  EmbeddedCheckoutSession,
  RedirectCheckoutSession,
} from "../../src/checkout/state/types";
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

const renderCheckout = async (checkout?: SuperwallCheckoutConfig) => {
  const rendered = renderWithProvider(
    () => ({ session: useSuperwallSession(), purchase: usePurchase() }),
    { config: { ...testConfig, checkout }, mock: { products } },
  );
  await flush();
  const session = rendered.result.current.session;
  const [product] = session.getSnapshot().products;
  if (!product) throw new Error("the mock host delivered no products");
  return { ...rendered, controller: controllerFor(session), product };
};

afterEach(() => {
  sessionCache.clear();
  vi.restoreAllMocks();
});

describe("usePurchase with web checkout", () => {
  it("opens the embedded sheet for a Stripe product and resolves with its outcome", async () => {
    const { result, controller } = await renderCheckout("sheet");
    const begin = vi.spyOn(controller, "beginCheckout").mockResolvedValue(embedded);

    let outcome: Promise<{ status: string }> | undefined;
    act(() => {
      outcome = result.current.purchase.purchase("primary");
    });
    await flush();

    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      cacheScope: "default",
    });

    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("PAYMENT_SUCCESS", { session: embedded });

    await expect(outcome).resolves.toEqual({ status: "completed" });
  });

  it("follows a redirect directive and reports the purchase as abandoned", async () => {
    const { result, controller } = await renderCheckout("applePay");
    const begin = vi.spyOn(controller, "beginCheckout").mockResolvedValue(redirect);

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    // Nothing was prepared for the wallet, so the purchase takes the sheet's
    // own session rather than the wallet's quote.
    expect(begin).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      cacheScope: "default",
    });
    expect(window.location.hash).toBe("#hosted-checkout");
    expect(outcome).toEqual({ status: "abandoned" });
  });

  it("fails on a directive it cannot act on", async () => {
    const { result, controller, product } = await renderCheckout("sheet");
    vi.spyOn(controller, "beginCheckout").mockImplementation(() =>
      Promise.resolve(JSON.parse('{ "directive": "unknown" }')),
    );

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase(product);
    });

    expect(outcome).toEqual({ status: "failed" });
  });

  it("never throws when the session cannot be created", async () => {
    const { result, controller } = await renderCheckout("sheet");
    vi.spyOn(controller, "beginCheckout").mockRejectedValue(new Error("network down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(outcome).toEqual({ status: "failed" });
    expect(error).toHaveBeenCalledWith("Error beginning web checkout:", expect.any(Error));
  });

  it("hands store products to the native purchase flow even with web checkout on", async () => {
    const { result, controller } = await renderCheckout("sheet");
    const begin = vi.spyOn(controller, "beginCheckout");

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
    const { result, controller } = await renderCheckout("sheet");
    const warm = vi.spyOn(controller, "prefetchCheckout").mockResolvedValue(null);

    act(() => result.current.purchase.prefetch());

    expect(warm).toHaveBeenCalledWith({
      referenceName: "primary",
      mode: "sheet",
      cacheScope: "default",
      silent: true,
    });
  });

  it("accepts a reference or a product and pools an embedded session", async () => {
    const { result, controller, product } = await renderCheckout("applePay");
    const warm = vi.spyOn(controller, "prefetchCheckout").mockResolvedValue(embedded);
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
      cacheScope: "apple-pay",
      silent: true,
    });
    expect(pooled).toEqual([embedded.clientSecret, embedded.clientSecret]);
    unsubscribe();
  });

  it("does nothing for store products or paywalls without web checkout", async () => {
    const sheet = await renderCheckout("sheet");
    const sheetWarm = vi.spyOn(sheet.controller, "prefetchCheckout");
    act(() => sheet.result.current.purchase.prefetch("secondary"));
    expect(sheetWarm).not.toHaveBeenCalled();

    const external = await renderCheckout("external");
    const externalWarm = vi.spyOn(external.controller, "prefetchCheckout");
    act(() => external.result.current.purchase.prefetch());
    expect(externalWarm).not.toHaveBeenCalled();
  });
});

describe("usePurchase with Apple Pay", () => {
  it("opens the wallet for a Stripe product and resolves with its outcome", async () => {
    const { result, controller } = await renderCheckout("applePay");
    const session = result.current.session;
    const wallet = vi
      .spyOn(applePayControllerFor(session), "purchase")
      .mockResolvedValue({ status: "completed" });
    const begin = vi.spyOn(controller, "beginCheckout");

    let outcome: { status: string } | undefined;
    await act(async () => {
      outcome = await result.current.purchase.purchase("primary");
    });

    expect(wallet).toHaveBeenCalledWith(
      "primary",
      expect.objectContaining({ productIdentifier: "test:price_1:no-trial" }),
    );
    expect(begin).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "completed" });
  });

  it("falls back to the embedded sheet when the wallet is unavailable", async () => {
    const { result, controller } = await renderCheckout("applePay");
    vi.spyOn(applePayControllerFor(result.current.session), "purchase").mockResolvedValue({
      status: "unavailable",
      reason: "apple_pay_not_available",
    });
    const begin = vi.spyOn(controller, "beginCheckout").mockResolvedValue(embedded);

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
      cacheScope: "default",
    });
    await expect(outcome).resolves.toEqual({ status: "completed" });
  });

  it("reuses an embedded session the wallet warm-up already produced", async () => {
    const { result, controller } = await renderCheckout("applePay");
    vi.spyOn(applePayControllerFor(result.current.session), "purchase").mockResolvedValue({
      status: "unavailable",
      reason: "no_apple_pay_quote",
    });
    sessionCache.set("primary", embedded, "apple-pay");
    const begin = vi.spyOn(controller, "beginCheckout");

    let outcome: Promise<{ status: string }> | undefined;
    act(() => {
      outcome = result.current.purchase.purchase("primary");
    });
    await flush();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: embedded.clientSecret });
    checkoutEvents.dispatch("SHEET_CLOSE", undefined);

    expect(begin).not.toHaveBeenCalled();
    await expect(outcome).resolves.toEqual({ status: "abandoned" });
  });

  it("prepares the wallet from a prefetched quote", async () => {
    const { result, controller } = await renderCheckout("applePay");
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
    vi.spyOn(controller, "prefetchCheckout").mockResolvedValue(quote);
    const prepare = vi
      .spyOn(applePayControllerFor(result.current.session), "prepare")
      .mockResolvedValue(undefined);

    await act(async () => {
      result.current.purchase.prefetch("primary");
      await flush();
    });

    expect(prepare).toHaveBeenCalledWith(quote, expect.any(Object));
  });
});
