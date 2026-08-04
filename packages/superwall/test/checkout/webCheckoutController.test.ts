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
    trial: { eligible: false },
    paywall: undefined,
    experiment: undefined,
    products: [{ reference: "monthly", product: "monthly", productId: "test:price_1:no-trial" }],
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
