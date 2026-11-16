import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallProduct, SuperwallRuntimeSnapshot } from "@superwall/runtime";
import {
  claimCustomStoreCheckout,
  CUSTOM_STORE_REQUIRES_APP_USER_ID,
  customStoreSessionBody,
  requestCustomStoreSession,
  RETURN_KEY_PREFIX,
  saveCustomStoreReturnRecord,
  type CustomStoreReturnRecord,
} from "../../../src/checkout/customStore";

const product: SuperwallProduct = {
  reference: "primary",
  productId: "custom|pro_monthly",
  variables: { price: "$9.99", rawPrice: "9.99", currencyCode: "USD" },
  source: "sdk",
};

const snapshotOf = (overrides: Record<string, unknown> = {}): SuperwallRuntimeSnapshot =>
  ({
    device: { publicApiKey: "pk_test" },
    user: { appUserId: "user_1", email: "a@b.co" },
    params: { campaign: "spring", count: 3 },
    products: [product],
    productsByReference: { primary: product },
    introductoryOffer: { eligible: false },
    ...overrides,
  }) as unknown as SuperwallRuntimeSnapshot;

const session = {
  checkoutContextId: "ctx_1",
  checkoutUrl: "https://pay.vendor.test/c/1",
  customTransactionId: "txn_1",
};

const answer = (body: unknown, status = 200) => {
  const fetchMock = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("customStoreSessionBody", () => {
  it("asks for a web checkout of the bare product with the checkout context", () => {
    const body = customStoreSessionBody(snapshotOf(), product);
    expect(body.productIdentifier).toBe("pro_monthly");
    expect(body.surface).toBe("web");
    expect(body.context.product.identifier).toBe("pro_monthly");
    expect(body.context.product.rawPrice).toBe(9.99);
    expect(body.context.identity.appUserId).toBe("user_1");
  });

  it("sends an anonymous buyer as a Superwall alias, which the backend takes for a redemption code", () => {
    const body = customStoreSessionBody(snapshotOf({ user: {}, params: {} }), product);
    expect(body.context.identity.appUserId).toMatch(/^\$SuperwallAlias:/);
  });

  it("sends an empty identifier for a product without one", () => {
    const { productId: _, ...bare } = product;
    expect(customStoreSessionBody(snapshotOf(), bare).productIdentifier).toBe("");
  });
});

describe("requestCustomStoreSession", () => {
  it("posts the session request with the public key and returns the session and buyer", async () => {
    const fetchMock = answer(session);
    const result = await requestCustomStoreSession(snapshotOf(), product);

    expect(result).toEqual({
      ...session,
      buyer: {
        appUserId: "user_1",
        email: "a@b.co",
        placementParams: { campaign: "spring", count: "3" },
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/checkout\/custom-store\/session$/);
    expect(init.headers).toMatchObject({ Authorization: "Bearer pk_test" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      productIdentifier: "pro_monthly",
      surface: "web",
    });
  });

  it("leaves out what the buyer does not have", async () => {
    answer(session);
    const result = await requestCustomStoreSession(
      snapshotOf({ user: { appUserId: "user_1" }, params: {} }),
      product,
    );
    expect(result.buyer).toEqual({ appUserId: "user_1" });
  });

  it("sends an empty bearer when the host gave no public API key", async () => {
    const fetchMock = answer(session);
    await requestCustomStoreSession(snapshotOf({ device: {} }), product);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer " });
  });

  it("names the missing buyer when the backend needs an app user id", async () => {
    answer({ _tag: CUSTOM_STORE_REQUIRES_APP_USER_ID, message: "nope" }, 400);
    await expect(requestCustomStoreSession(snapshotOf(), product)).rejects.toMatchObject({
      message:
        "Custom store checkout refused this buyer's app_user_id: pass a real user id or none at all",
      tag: CUSTOM_STORE_REQUIRES_APP_USER_ID,
    });
  });

  it("passes on the backend's message and tag for any other refusal", async () => {
    answer({ _tag: "CustomStoreCheckoutNotConfigured", message: "No checkout endpoint" }, 404);
    await expect(requestCustomStoreSession(snapshotOf(), product)).rejects.toMatchObject({
      message: "No checkout endpoint",
      tag: "CustomStoreCheckoutNotConfigured",
    });
  });

  it("names the status when the refusal has no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 })),
    );
    await expect(requestCustomStoreSession(snapshotOf(), product)).rejects.toThrow(
      "The checkout request answered 502",
    );
  });

  it("refuses a session whose checkout is not https", async () => {
    answer({ ...session, checkoutUrl: "http://pay.vendor.test/c/1" });
    await expect(requestCustomStoreSession(snapshotOf(), product)).rejects.toThrow(
      "Custom store checkout returned an invalid session",
    );
  });

  it("refuses a session without a transaction id", async () => {
    answer({ checkoutContextId: "ctx_1", checkoutUrl: session.checkoutUrl });
    await expect(requestCustomStoreSession(snapshotOf(), product)).rejects.toThrow(
      "Custom store checkout returned an invalid session",
    );
  });

  it("tells a timeout from a request that could not be sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    await expect(requestCustomStoreSession(snapshotOf(), product)).rejects.toThrow(
      "The store's checkout took too long to start",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(requestCustomStoreSession(snapshotOf(), product)).rejects.toThrow(
      "The checkout request could not be sent",
    );
  });
});

describe("saveCustomStoreReturnRecord", () => {
  const record: CustomStoreReturnRecord = {
    version: 1,
    checkoutContextId: "ctx_1",
    paywallUrl: "https://acme.superwall.app/pro",
    productReference: "primary",
    productIdentifier: "custom|pro_monthly",
    customTransactionId: "txn_1",
    resolution: { type: "default" },
    buyer: { appUserId: "user_1" },
    createdAt: 1,
  };

  it("keeps the record under the return page's key", () => {
    expect(saveCustomStoreReturnRecord(record)).toBe(true);
    expect(JSON.parse(window.sessionStorage.getItem(`${RETURN_KEY_PREFIX}ctx_1`) ?? "")).toEqual(
      record,
    );
  });

  it("reports false and warns when storage is off", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(saveCustomStoreReturnRecord(record)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe("claimCustomStoreCheckout", () => {
  it("lets one checkout run per paywall until it is released", () => {
    const paywall = {};
    const release = claimCustomStoreCheckout(paywall);
    expect(release).toBeTypeOf("function");
    expect(claimCustomStoreCheckout(paywall)).toBeUndefined();
    expect(claimCustomStoreCheckout({})).toBeTypeOf("function");
    release?.();
    expect(claimCustomStoreCheckout(paywall)).toBeTypeOf("function");
  });
});
