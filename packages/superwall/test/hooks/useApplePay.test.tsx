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

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: stripe.loadStripe }));
vi.mock("../../src/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/host")>()),
  hostOf: () => host.current,
}));

const { checkApplePay, useApplePay, usePurchase, useSuperwallSession } =
  await import("../../src/hooks");
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

const on = { available: true };

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

const merchant = `merchant.${window.location.hostname}.stripe`;

const withActiveCard = (answer: (merchantIdentifier: string) => unknown = async () => true) => {
  const global = { canMakePaymentsWithActiveCard: vi.fn(answer) };
  vi.stubGlobal("ApplePaySession", global);
  return global;
};

const deferred = () => {
  const settle: { resolve?: (value: unknown) => void } = {};
  const promise = new Promise<unknown>((resolve) => {
    settle.resolve = resolve;
  });
  return { promise, resolve: (value: unknown) => settle.resolve?.(value) };
};

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
  it.each<SuperwallHost>([
    "ios-sdk",
    "android-sdk",
    "studio",
    "web-sdk",
    "web-paywall",
    "web-teleport",
    "browser",
  ])("asks Apple the same way on %s", async (name) => {
    host.current = name;
    const global = withActiveCard();
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(on);
    expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledWith(merchant);
    expect(global.canMakePaymentsWithActiveCard.mock.contexts[0]).toBe(global);
  });

  it.each<SuperwallHost>(["ios-sdk", "android-sdk", "studio"])(
    "never opens the wallet for a product on %s, even when Apple Pay is available",
    async (name) => {
      host.current = name;
      withActiveCard();
      const { result } = await render(() => useApplePay("primary"));
      expect(result.current.value).toEqual({
        ...on,
        product: {
          status: "unavailable",
          reason: "unsupported_host",
          message:
            "Inside the iOS or Android SDK and in Studio a purchase never opens the Apple Pay wallet.",
        },
      });
    },
  );

  it("has no card inside the iOS SDK when Apple says Wallet holds none", async () => {
    host.current = "ios-sdk";
    withActiveCard(async () => false);
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual({
      available: false,
      reason: "no_active_card",
      message: "Apple Pay has no card to pay with here: Wallet holds none.",
    });
  });
});

describe("useApplePay's device answer", () => {
  it("is an unsupported browser when there is no ApplePaySession, as in Chrome on a desktop", async () => {
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual({
      available: false,
      reason: "unsupported_browser",
      message:
        "This page has no ApplePaySession.canMakePaymentsWithActiveCard, so it cannot check for a card.",
    });
  });

  it("is an insecure context on a page not served over HTTPS, before asking the browser", async () => {
    vi.stubGlobal("isSecureContext", false);
    const global = withActiveCard();
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(off("insecure_context"));
    expect(global.canMakePaymentsWithActiveCard).not.toHaveBeenCalled();
  });

  it("is an insecure context, with Safari's error, when Safari refuses an insecure document", async () => {
    const error = new Error("Trying to start an Apple Pay session from an insecure document.");
    error.name = "InvalidAccessError";
    withActiveCard(() => {
      throw error;
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(
      off("insecure_context", { name: "InvalidAccessError", message: error.message }),
    );
  });

  it("names a failed check and returns the browser's error, never throwing", async () => {
    withActiveCard(() => {
      throw new Error("user agent scripts were evaluated");
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(
      off("check_failed", { name: "Error", message: "user agent scripts were evaluated" }),
    );
  });

  it("names a failed check when the browser throws something that is not an Error", async () => {
    withActiveCard(() => {
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
    withActiveCard(() => {
      throw new Error("different security origin");
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(
      off("cross_origin_frame", { name: "Error", message: "different security origin" }),
    );
  });

  it("is a failed check, not a cross-origin frame, in a frame of the same origin", async () => {
    vi.stubGlobal("top", { location: { origin: window.location.origin } });
    withActiveCard(() => {
      throw new Error("other");
    });
    const { result } = await render(() => useApplePay());
    expect(result.current.value).toEqual(off("check_failed", { name: "Error", message: "other" }));
  });

  it("asks the browser once, not on every render", async () => {
    const global = withActiveCard();
    const { result, rerender } = await render(() => useApplePay());
    const first = result.current.value;
    rerender();
    expect(result.current.value).toBe(first);
    expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledOnce();
  });
});

describe("useApplePay for a product", () => {
  it("is not prepared when nothing prepared the wallet for it, whatever the device says", async () => {
    withActiveCard();
    const { result } = await render(() => useApplePay("primary"));
    expect(result.current.value).toEqual({
      ...on,
      product: notReady("not_prepared"),
    });
  });

  it("follows the wallet from preparing to ready, and back to not prepared on clear", async () => {
    withActiveCard();
    const { result, applePay } = await render(() => useApplePay(products[0] as never));

    stripe.answer.value = { applePay: true };
    stripe.hold();
    let preparing: Promise<void> = Promise.resolve();
    act(() => {
      preparing = applePay.prepare(quote);
    });
    expect(result.current.value).toEqual({ ...on, product: { status: "preparing" } });

    await act(async () => {
      stripe.release();
      await preparing;
    });
    expect(result.current.value).toEqual({ ...on, product: { status: "ready" } });

    act(() => applePay.clear());
    expect(result.current.value).toEqual({
      ...on,
      product: notReady("not_prepared"),
    });
  });

  it("turns unavailable with the reason when Stripe finds no Apple Pay", async () => {
    withActiveCard();
    const { result, applePay } = await render(() => useApplePay("primary"));

    stripe.answer.value = { applePay: false };
    await act(() => applePay.prepare(quote));
    expect(result.current.value).toEqual({
      ...on,
      product: {
        status: "unavailable",
        reason: "stripe_declined" satisfies ApplePayWalletReason,
        message:
          "Stripe found no way to pay with Apple Pay: no card in Wallet, the domain is not registered with Stripe, or Safari's Apple Pay check setting is off.",
      },
    });
  });

  it("keeps the same result while the wallet's state stays the same", async () => {
    withActiveCard();
    const { result, rerender, applePay } = await render(() => useApplePay("primary"));
    act(() => applePay.markUnavailable("primary", "session_unsupported"));
    const first = result.current.value;
    act(() => applePay.markUnavailable("primary", "session_unsupported"));
    rerender();
    expect(result.current.value).toBe(first);
    expect(first).toEqual({ ...on, product: notReady("session_unsupported") });
  });

  it("carries the error a step threw, as its name and message", async () => {
    withActiveCard();
    const { result, applePay } = await render(() => useApplePay("primary"));
    act(() => applePay.markUnavailable("primary", "session_failed", new TypeError("offline")));
    expect(result.current.value).toEqual({
      ...on,
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
    withActiveCard();
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
    withActiveCard();
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
      ...on,
      product: { status: "ready" },
    });

    act(() => {
      void result.current.value.purchase.purchase("primary", { checkout: "applePay" });
    });
    await flush();
    expect(stripe.paymentRequest.show).toHaveBeenCalledOnce();
  });
});

const renderHook = () =>
  renderWithProvider(() => useApplePay(), {
    host: { products, device: { platform: "web", publicApiKey: "pk_test" } },
  });

describe("useApplePay's card answer", () => {
  it("is checking on the first render, then available once Apple says there is a card", async () => {
    withActiveCard(async () => true);
    const { result } = renderHook();
    expect(result.current).toEqual(off("checking"));
    await flush();
    expect(result.current).toEqual(on);
  });

  it("has no active card when Apple answers false, or anything but true", async () => {
    withActiveCard(async () => false);
    expect(await checkApplePay()).toEqual(off("no_active_card"));
    withActiveCard(() => "yes");
    expect(await checkApplePay()).toEqual(off("no_active_card"));
  });

  it("is an unsupported browser when ApplePaySession has no card check", async () => {
    vi.stubGlobal("ApplePaySession", {});
    expect(await checkApplePay()).toEqual(off("unsupported_browser"));
  });

  it("names a failed card check, with the error, whether Apple throws or rejects", async () => {
    withActiveCard(() => {
      throw new Error("boom");
    });
    expect(await checkApplePay()).toEqual(off("check_failed", { name: "Error", message: "boom" }));
    withActiveCard(() => Promise.reject(new Error("later")));
    expect(await checkApplePay()).toEqual(off("check_failed", { name: "Error", message: "later" }));
  });

  it("names Safari's insecure-document refusal and a cross-origin frame on the card check", async () => {
    withActiveCard(() => {
      throw new Error("Trying to start an Apple Pay session from an insecure document.");
    });
    expect(await checkApplePay()).toMatchObject({ reason: "insecure_context" });
    vi.stubGlobal("top", { location: { origin: "https://merchant.example" } });
    withActiveCard(() => {
      throw new Error("different security origin");
    });
    expect(await checkApplePay()).toMatchObject({ reason: "cross_origin_frame" });
  });

  it("starts with the answer the page already has, without asking again", async () => {
    const global = withActiveCard(async () => false);
    await checkApplePay();
    const { result } = renderHook();
    expect(result.current).toEqual(off("no_active_card"));
    expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledOnce();
  });

  it("asks Apple once for every hook and call on the page", async () => {
    const global = withActiveCard(async () => true);
    const { result } = renderWithProvider(() => [useApplePay(), useApplePay("primary")], {
      host: { products, device: { platform: "web", publicApiKey: "pk_test" } },
    });
    const [first, second] = await Promise.all([checkApplePay(), checkApplePay()]);
    await flush();
    expect([first, second]).toEqual([on, on]);
    expect(result.current.map(({ available }) => available)).toEqual([true, true]);
    expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledOnce();
  });

  it("is preparing for a product while Apple has not answered", async () => {
    withActiveCard(() => new Promise(() => {}));
    const { result } = renderWithProvider(() => useApplePay("primary"), {
      host: { products, device: { platform: "web", publicApiKey: "pk_test" } },
    });
    expect(result.current).toEqual({ ...off("checking"), product: { status: "preparing" } });
  });

  it("asks Apple again on the next mount and call after a check that threw", async () => {
    let calls = 0;
    const global = withActiveCard(async () => {
      calls += 1;
      if (calls === 1) throw new Error("flaky");
      return calls !== 2;
    });
    const first = renderHook();
    await flush();
    expect(first.result.current).toEqual(off("check_failed", { name: "Error", message: "flaky" }));
    first.unmount();
    const second = renderHook();
    await flush();
    expect(second.result.current).toEqual(off("no_active_card"));
    expect(await checkApplePay()).toEqual(off("no_active_card"));
    expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledTimes(2);
  });

  it("asks Apple again after a check that threw synchronously", async () => {
    let calls = 0;
    withActiveCard(() => {
      calls += 1;
      if (calls === 1) throw new Error("flaky");
      return true;
    });
    expect(await checkApplePay()).toEqual(off("check_failed", { name: "Error", message: "flaky" }));
    expect(await checkApplePay()).toEqual(on);
  });

  it("times out after 1.5 seconds, then re-renders with Apple's late answer and keeps it", async () => {
    vi.useFakeTimers();
    try {
      const late = deferred();
      const global = withActiveCard(() => late.promise);
      const { result } = renderHook();
      await act(() => vi.advanceTimersByTimeAsync(1499));
      expect(result.current).toEqual(off("checking"));
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(result.current).toEqual(off("timed_out"));
      await act(async () => {
        late.resolve(true);
        await late.promise;
      });
      expect(result.current).toEqual(on);
      expect(await checkApplePay()).toEqual(on);
      expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks Apple again on a call made after a timeout, and takes whichever answer comes", async () => {
    vi.useFakeTimers();
    try {
      const answers = [deferred(), deferred()];
      let calls = 0;
      const global = withActiveCard(() => answers[calls++]?.promise ?? new Promise(() => {}));
      const first = checkApplePay();
      await vi.advanceTimersByTimeAsync(1500);
      expect(await first).toEqual(off("timed_out"));
      const second = checkApplePay();
      expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledTimes(2);
      answers[1]?.resolve(true);
      expect(await second).toEqual(on);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await checkApplePay()).toEqual(on);
      expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks once for calls made together, while Apple has not answered", async () => {
    vi.useFakeTimers();
    try {
      const global = withActiveCard(() => new Promise(() => {}));
      const both = Promise.all([checkApplePay(), checkApplePay()]);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await both).toEqual([off("timed_out"), off("timed_out")]);
      expect(global.canMakePaymentsWithActiveCard).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
