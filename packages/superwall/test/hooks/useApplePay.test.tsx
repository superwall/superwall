import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuperwallHost } from "../../src/host";
import type { ElementsCheckoutSession } from "../../src/checkout/types";
import type { ApplePayWalletReason } from "../../src/hooks";

const stripe = vi.hoisted(() => {
  const answer = { value: undefined as unknown };
  const paymentRequest = {
    on: vi.fn(() => paymentRequest),
    canMakePayment: vi.fn(async () => answer.value),
    show: vi.fn(),
  };
  let release: (() => void) | undefined;
  let gate = Promise.resolve();
  return {
    answer,
    hold: () => {
      gate = new Promise((resolve) => {
        release = resolve;
      });
    },
    paymentRequest,
    release: () => release?.(),
    loadStripe: vi.fn(async () => {
      await gate;
      return { paymentRequest: () => paymentRequest };
    }),
  };
});

const host = vi.hoisted(() => ({ current: "web-paywall" as SuperwallHost }));

vi.mock("@stripe/stripe-js", () => ({ loadStripe: stripe.loadStripe }));
vi.mock("../../src/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/host")>()),
  hostOf: () => host.current,
}));

const { useApplePay, usePurchase, useSuperwallSession } = await import("../../src/hooks");
const { applePayFor, sessionsFor } = await import("../../src/checkout/flow");
const { flush, renderWithProvider, testConfig } = await import("../helpers");

const products = [{ reference: "primary", productId: "test:price_1:no-trial" }];

const quote: ElementsCheckoutSession = {
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test_123",
  checkoutContextId: "ctx_1",
  referenceName: "primary",
  subscriptionDetails: { amount: 1999, currency: "usd", interval: "month", intervalCount: 1 },
};

const off = (reason: string, error?: { name: string; message: string }) => ({
  available: false,
  reason,
  message: expect.any(String),
  ...(error ? { error } : {}),
});

const notReady = (reason: string, error?: { name: string; message: string }) => ({
  status: "unavailable",
  reason,
  message: expect.any(String),
  ...(error ? { error } : {}),
});

const withApplePaySession = (canMakePayments: () => unknown) =>
  vi.stubGlobal("ApplePaySession", { canMakePayments });

const render = async <T,>(hook: () => T, checkout?: "sheet" | "applePay") => {
  const rendered = renderWithProvider(() => ({ session: useSuperwallSession(), value: hook() }), {
    ...(checkout === undefined ? {} : { config: { ...testConfig, checkout } }),
    host: { products, device: { platform: "web", publicApiKey: "pk_test" } },
  });
  await flush();
  return { ...rendered, applePay: applePayFor(rendered.result.current.session) };
};

beforeEach(() => {
  host.current = "web-paywall";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  stripe.paymentRequest.show.mockClear();
});

describe("useApplePay on each host", () => {
  it.each<SuperwallHost>(["web-sdk", "web-paywall", "web-teleport", "browser"])(
    "answers on %s",
    async (name) => {
      host.current = name;
      withApplePaySession(() => true);
      const { result } = await render(() => useApplePay());
      expect(result.current.value).toEqual({ available: true });
    },
  );

  it.each<SuperwallHost>(["ios-sdk", "android-sdk", "studio"])(
    "is undefined on %s, even with a product and a browser that could pay",
    async (name) => {
      host.current = name;
      const canMakePayments = vi.fn(() => true);
      withApplePaySession(canMakePayments);
      const { result } = await render(() => ({
        device: useApplePay(),
        product: useApplePay("primary"),
      }));
      expect(result.current.value).toEqual({ device: undefined, product: undefined });
      expect(canMakePayments).not.toHaveBeenCalled();
    },
  );
});

describe("useApplePay's device answer", () => {
  it("is an unsupported browser when there is no ApplePaySession, as in Chrome on a desktop", async () => {
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual({
      available: false,
      reason: "unsupported_browser",
      message: "This browser has no Apple Pay JS, so it cannot open the wallet itself.",
    });
  });

  it("is an insecure context on a page not served over HTTPS, before asking the browser", async () => {
    vi.stubGlobal("isSecureContext", false);
    const canMakePayments = vi.fn(() => true);
    withApplePaySession(canMakePayments);
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(off("insecure_context"));
    expect(canMakePayments).not.toHaveBeenCalled();
  });

  it("is an insecure context, with Safari's error, when Safari refuses an insecure document", async () => {
    const error = new Error("Trying to start an Apple Pay session from an insecure document.");
    error.name = "InvalidAccessError";
    withApplePaySession(() => {
      throw error;
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(
      off("insecure_context", { name: "InvalidAccessError", message: error.message }),
    );
  });

  it("is an unsupported device when the browser says it cannot pay, or answers with anything but true", async () => {
    const unsupported = off("device_unsupported");
    withApplePaySession(() => false);
    expect((await render(() => useApplePay())).result.current.value).toEqual(unsupported);
    withApplePaySession(() => "yes");
    expect((await render(() => useApplePay())).result.current.value).toEqual(unsupported);
  });

  it("names a failed check and returns the browser's error, never throwing", async () => {
    withApplePaySession(() => {
      throw new Error("user agent scripts were evaluated");
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(
      off("check_failed", { name: "Error", message: "user agent scripts were evaluated" }),
    );
  });

  it("names a failed check when the browser throws something that is not an Error", async () => {
    withApplePaySession(() => {
      throw "nope";
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(off("check_failed", { name: "Error", message: "nope" }));
  });

  it.each([
    [
      "a frame whose parent is out of reach",
      {
        get location(): never {
          throw new Error("blocked");
        },
      },
    ],
    ["a frame of another origin", { location: { origin: "https://merchant.example" } }],
  ])("names a cross-origin frame when the check throws in %s", async (_, top) => {
    vi.stubGlobal("top", top);
    withApplePaySession(() => {
      throw new Error("different security origin");
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(
      off("cross_origin_frame", { name: "Error", message: "different security origin" }),
    );
  });

  it("is a failed check, not a cross-origin frame, in a frame of the same origin", async () => {
    vi.stubGlobal("top", { location: { origin: window.location.origin } });
    withApplePaySession(() => {
      throw new Error("other");
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(off("check_failed", { name: "Error", message: "other" }));
  });

  it("asks the browser once, not on every render", async () => {
    const canMakePayments = vi.fn(() => true);
    withApplePaySession(canMakePayments);
    const { result, rerender } = await render(() => useApplePay());
    const first = result.current.value;
    rerender();
    expect(result.current.value).toBe(first);
    expect(canMakePayments).toHaveBeenCalledOnce();
  });
});

describe("useApplePay for a product", () => {
  it("is not prepared when nothing prepared the wallet for it, whatever the device says", async () => {
    withApplePaySession(() => true);
    const { result } = await render(() => useApplePay("primary"));
    expect(result.current.value).toEqual({
      available: true,
      product: notReady("not_prepared"),
    });
  });

  it("follows the wallet from preparing to ready, and back to not prepared on clear", async () => {
    withApplePaySession(() => true);
    const { result, applePay } = await render(() => useApplePay(products[0] as never));

    stripe.answer.value = { applePay: true };
    stripe.hold();
    let preparing: Promise<void> = Promise.resolve();
    act(() => {
      preparing = applePay.prepare(quote);
    });
    expect(result.current.value).toEqual({ available: true, product: { status: "preparing" } });

    await act(async () => {
      stripe.release();
      await preparing;
    });
    expect(result.current.value).toEqual({ available: true, product: { status: "ready" } });

    act(() => applePay.clear());
    expect(result.current.value).toEqual({
      available: true,
      product: notReady("not_prepared"),
    });
  });

  it("turns unavailable with the reason when Stripe finds no Apple Pay", async () => {
    withApplePaySession(() => true);
    const { result, applePay } = await render(() => useApplePay("primary"));

    stripe.answer.value = { applePay: false };
    await act(() => applePay.prepare(quote));
    expect(result.current.value).toEqual({
      available: true,
      product: {
        status: "unavailable",
        reason: "stripe_declined" satisfies ApplePayWalletReason,
        message:
          "Stripe found no way to pay with Apple Pay: no card in Wallet, the domain is not registered with Stripe, or Safari's Apple Pay check setting is off.",
      },
    });
  });

  it("keeps the same result while the wallet's state stays the same", async () => {
    withApplePaySession(() => true);
    const { result, rerender, applePay } = await render(() => useApplePay("primary"));
    act(() => applePay.markUnavailable("primary", "session_unsupported"));
    const first = result.current.value;
    act(() => applePay.markUnavailable("primary", "session_unsupported"));
    rerender();
    expect(result.current.value).toBe(first);
    expect(first).toEqual({ available: true, product: notReady("session_unsupported") });
  });

  it("carries the error a step threw, as its name and message", async () => {
    withApplePaySession(() => true);
    const { result, applePay } = await render(() => useApplePay("primary"));
    act(() => applePay.markUnavailable("primary", "session_failed", new TypeError("offline")));
    expect(result.current.value).toEqual({
      available: true,
      product: notReady("session_failed", { name: "TypeError", message: "offline" }),
    });
  });

  it("gives the browser's reason for the product when the browser cannot open the wallet", async () => {
    const { result, applePay } = await render(() => useApplePay("primary"));
    act(() => applePay.markUnavailable("primary", "session_failed"));
    expect(result.current.value).toEqual({
      ...off("unsupported_browser"),
      product: notReady("unsupported_browser"),
    });
  });
});

describe("useApplePay with a per-call Apple Pay purchase", () => {
  it("is not prepared on a sheet paywall, so the purchase falls back to the sheet", async () => {
    withApplePaySession(() => true);
    const { result } = await render(
      () => ({ applePay: useApplePay("primary"), purchase: usePurchase() }),
      "sheet",
    );
    const sessions = sessionsFor(result.current.session);
    const begin = vi.spyOn(sessions, "begin").mockRejectedValue(new Error("no backend"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(result.current.value.applePay).toMatchObject({
      product: notReady("not_prepared"),
    });
    await act(() => result.current.value.purchase.purchase("primary", { checkout: "applePay" }));
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ mode: "sheet" }));
    expect(stripe.paymentRequest.show).not.toHaveBeenCalled();
  });

  it("is ready once prefetch asks for Apple Pay, and the purchase opens the wallet", async () => {
    withApplePaySession(() => true);
    stripe.answer.value = { applePay: true };
    const { result } = await render(
      () => ({ applePay: useApplePay("primary"), purchase: usePurchase() }),
      "sheet",
    );
    const sessions = sessionsFor(result.current.session);
    const prefetch = vi.spyOn(sessions, "prefetch").mockResolvedValue(quote);

    await act(async () => {
      result.current.value.purchase.prefetch("primary", { checkout: "applePay" });
      await flush();
    });
    expect(prefetch).toHaveBeenCalledWith(expect.objectContaining({ mode: "applePay" }));
    expect(result.current.value.applePay).toEqual({
      available: true,
      product: { status: "ready" },
    });

    act(() => {
      void result.current.value.purchase.purchase("primary", { checkout: "applePay" });
    });
    await flush();
    expect(stripe.paymentRequest.show).toHaveBeenCalledOnce();
  });
});
