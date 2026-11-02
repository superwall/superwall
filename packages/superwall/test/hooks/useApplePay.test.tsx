import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuperwallHost } from "../../src/host";
import type { ElementsCheckoutSession } from "../../src/checkout/types";

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
    release: () => release?.(),
    loadStripe: vi.fn(async () => {
      await gate;
      return { paymentRequest: () => paymentRequest };
    }),
  };
});

const host = vi.hoisted(() => ({ current: "web-paywall" as SuperwallHost }));

vi.mock("@stripe/stripe-js", () => ({ loadStripe: stripe.loadStripe }));
vi.mock("../../src/host", () => ({ hostOf: () => host.current }));

const { useApplePay, useSuperwallSession } = await import("../../src/hooks");
const { applePayFor } = await import("../../src/checkout/flow");
const { flush, renderWithProvider } = await import("../helpers");

const products = [{ reference: "primary", productId: "test:price_1:no-trial" }];

const quote: ElementsCheckoutSession = {
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test_123",
  checkoutContextId: "ctx_1",
  referenceName: "primary",
  subscriptionDetails: { amount: 1999, currency: "usd", interval: "month", intervalCount: 1 },
};

const withApplePaySession = (canMakePayments: () => unknown) =>
  vi.stubGlobal("ApplePaySession", { canMakePayments });

const render = async <T,>(hook: () => T) => {
  const rendered = renderWithProvider(() => ({ session: useSuperwallSession(), value: hook() }), {
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
  it("is false when the browser has no ApplePaySession", async () => {
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual({ available: false });
  });

  it("is false when the browser says it cannot pay, or answers with anything but true", async () => {
    withApplePaySession(() => false);
    expect((await render(() => useApplePay())).result.current.value).toEqual({ available: false });
    withApplePaySession(() => "yes");
    expect((await render(() => useApplePay())).result.current.value).toEqual({ available: false });
  });

  it("is false, never an exception, when the check throws", async () => {
    withApplePaySession(() => {
      throw new Error("insecure document");
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual({ available: false });
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
      status: "unavailable",
      reason: "not_prepared",
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
    expect(result.current.value).toEqual({ available: true, status: "preparing" });

    await act(async () => {
      stripe.release();
      await preparing;
    });
    expect(result.current.value).toEqual({ available: true, status: "ready" });

    act(() => applePay.clear());
    expect(result.current.value).toEqual({
      available: true,
      status: "unavailable",
      reason: "not_prepared",
    });
  });

  it("turns unavailable with the reason when Stripe finds no Apple Pay", async () => {
    withApplePaySession(() => true);
    const { result, applePay } = await render(() => useApplePay("primary"));

    stripe.answer.value = { applePay: false };
    await act(() => applePay.prepare(quote));
    expect(result.current.value).toEqual({
      available: true,
      status: "unavailable",
      reason: "apple_pay_not_available",
    });
  });

  it("keeps the same result while the wallet's state stays the same", async () => {
    const { result, rerender, applePay } = await render(() => useApplePay("primary"));
    act(() => applePay.markUnavailable("primary", "prepare_failed"));
    const first = result.current.value;
    act(() => applePay.markUnavailable("primary", "prepare_failed"));
    rerender();
    expect(result.current.value).toBe(first);
    expect(first).toEqual({ available: false, status: "unavailable", reason: "prepare_failed" });
  });
});
