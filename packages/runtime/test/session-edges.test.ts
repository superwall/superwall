import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSuperwallState,
  createMockSuperwallTransport,
  createSuperwallProduct,
  createSuperwallSession,
  decodeBase64Utf8,
} from "../src";
import { TestTransport, flushMicrotasks } from "./testTransport";

const createSession = (options: Parameters<typeof createSuperwallSession>[0] = {}) => {
  const transport = new TestTransport();
  const session = createSuperwallSession({ transport, ...options });
  session.start();
  return { session, transport };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("session accessors", () => {
  it("exposes products, config, locale, and per-reference lookup", () => {
    const config = { products: { primary: "pro_year" } };
    const { session } = createSession({ config });

    expect(session.config).toBe(config);
    expect(session.locale).toBe(session.getSnapshot().locale);
    expect(session.products.map((product) => product.reference)).toEqual(["primary"]);
    expect(session.getProduct("primary")?.reference).toBe("primary");
    expect(session.getProduct("missing")).toBeUndefined();
  });

  it("notifies subscribers on changes and stops after unsubscribe", () => {
    const { session, transport } = createSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    transport.accept({ event_name: "template_substitutions_prefix", prefix: "freeTrial" });
    expect(listener).toHaveBeenCalled();

    const calls = listener.mock.calls.length;
    unsubscribe();
    transport.accept({ event_name: "template_substitutions_prefix", prefix: null });
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it("treats re-configuring with the same config object as a no-op", () => {
    const config = { products: { primary: "pro_year" } };
    const { session } = createSession({ config });

    const before = session.getSnapshot();
    session.configure(config);
    expect(session.getSnapshot()).toBe(before);
  });
});

describe("forced trial eligibility", () => {
  it("alwaysIneligible pins trial state to false", () => {
    const { session, transport } = createSession({
      config: { introductoryOfferEligibility: "alwaysIneligible" },
    });
    expect(session.getSnapshot().trial).toEqual({ eligible: false });

    // ...and the SDK's prefix signal must not override it
    transport.accept({ event_name: "template_substitutions_prefix", prefix: "freeTrial" });
    expect(session.getSnapshot().trial).toEqual({ eligible: false });
  });
});

describe("transaction attribution by product_identifier", () => {
  const seededProduct = createSuperwallProduct({
    reference: "primary",
    product: "primary",
    productId: "pid_year",
    productIdentifier: "store_year",
  });

  it("resolves a pending purchase whose store identifier matches", async () => {
    const { session, transport } = createSession({ products: [seededProduct] });

    const result = session.purchase("primary");
    transport.accept({ event_name: "transaction_complete", product_identifier: "store_year" });

    await expect(result).resolves.toMatchObject({
      status: "completed",
      product: { reference: "primary" },
    });
  });

  it("does not resolve a pending purchase for an unrelated transaction", async () => {
    const { session, transport } = createSession({ products: [seededProduct] });

    const result = session.purchase("primary");
    transport.accept({ event_name: "transaction_complete", product_identifier: "other_product" });
    await flushMicrotasks();

    // the unrelated transaction is recorded against a placeholder product…
    expect(session.getSnapshot().lastTransaction).toMatchObject({
      status: "completed",
      product: { reference: "other_product" },
    });
    // …while the purchase stays pending
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");

    session.close();
    void result;
  });

  it("attributes a bare transaction to a snapshot product by identifier when nothing is pending", () => {
    const { session, transport } = createSession({ products: [seededProduct] });

    transport.accept({ event_name: "transaction_complete", product_identifier: "pid_year" });
    expect(session.getSnapshot().lastTransaction?.product.reference).toBe("primary");
  });

  it("falls back to an unknown placeholder without any product info", () => {
    const { session, transport } = createSession();

    transport.accept({ event_name: "transaction_complete" });
    expect(session.getSnapshot().lastTransaction?.product.reference).toBe("unknown");
  });
});

describe("purchase timeout with a newer purchase in flight", () => {
  it("fails only the timed-out purchase and keeps the newer one pending", async () => {
    vi.useFakeTimers();
    const { session } = createSession({
      products: [createSuperwallProduct("primary"), createSuperwallProduct("secondary")],
    });

    const first = session.purchase("primary", { timeoutMs: 50 });
    const second = session.purchase("secondary");

    await vi.advanceTimersByTimeAsync(60);

    await expect(first).resolves.toMatchObject({ status: "failed", reason: "timeout" });
    expect(session.getSnapshot().lastPurchaseFailure?.product.reference).toBe("primary");
    // the newer purchase is untouched by the older purchase's failure
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("secondary");

    session.close();
    void second;
  });
});

describe("callback state naming", () => {
  it("falls back to 'callback' when a name sanitizes to nothing", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "callback_result",
      request_id: "unknown-request",
      name: "!!!",
      status: "success",
    });

    expect(session.getSnapshot().callbackStates.callback).toEqual({
      result: "success",
      data: undefined,
    });
  });
});

describe("request ids without crypto.randomUUID", () => {
  it("still generates unique prefixed ids", () => {
    vi.stubGlobal("crypto", {});
    const { session, transport } = createSession();

    void session.requestPermission("notification");

    const posted = transport.outgoing.find(
      (message) => message.event_name === "request_permission",
    );
    expect(posted).toMatchObject({
      event_name: "request_permission",
      request_id: expect.stringMatching(/^permission-notification-/),
    });
  });
});

describe("dynamic trial reminder product lookup", () => {
  it("matches the trial product by productId when store identifiers differ", () => {
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { session, transport } = createSession({
      products: [
        createSuperwallProduct({
          reference: "primary",
          product: "primary",
          productId: "pid_year",
          productIdentifier: "store_year",
        }),
      ],
      config: {
        notifications: {
          trialReminder: ({ product }) => ({
            title: product?.reference ?? "no-product",
            body: "body",
            delayMs: 1000,
          }),
        },
      },
    });

    transport.accept({
      event_name: "freeTrial_start",
      trial_end_date: trialEnd,
      product_identifier: "pid_year",
    });

    expect(transport.outgoing).toContainEqual(
      expect.objectContaining({ event_name: "schedule_notification", title: "primary" }),
    );
    void session;
  });
});

describe("mock restore", () => {
  it("responds to restore() with a completed transaction", async () => {
    const session = createSuperwallSession({ transport: createMockSuperwallTransport() });
    session.start({ sendPing: true });
    await flushMicrotasks();

    session.restore();
    await flushMicrotasks();

    expect(session.getSnapshot().lastTransaction?.status).toBe("completed");
  });
});

describe("legacy top-level product variables", () => {
  it("builds product state from primary/secondary/tertiary variables", () => {
    const state = buildSuperwallState({
      variables: { primary: { price: "$1.00" } },
      products: [],
    });

    expect(state).toMatchObject({ products: { primary: { price: "$1.00" } } });
  });
});

describe("base64 decoding without atob", () => {
  it("decodes via Buffer when atob is unavailable", () => {
    const encoded = Buffer.from("héllo ✓", "utf8").toString("base64");
    vi.stubGlobal("atob", undefined);

    expect(decodeBase64Utf8(encoded)).toBe("héllo ✓");
  });

  it("throws when no decoder exists at all", () => {
    vi.stubGlobal("atob", undefined);
    vi.stubGlobal("Buffer", undefined);

    expect(() => decodeBase64Utf8("aGk=")).toThrow("No base64 decoder is available");
  });
});
