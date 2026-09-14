import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completedWebCheckout,
  readCompletedWebCheckout,
  resolveCompletedWebCheckout,
} from "../../src/checkout/redemption";
import type { PaywallSession } from "../../src/checkout/flow";

const NONE = Symbol("none");
const fakePaywall = (publicApiKey: unknown = "pk_test") => {
  const key = publicApiKey === NONE ? undefined : publicApiKey;
  const postMessage = vi.fn();
  const session: PaywallSession = {
    getSnapshot: () => ({ device: { publicApiKey: key } }) as never,
    postMessage,
  };
  return { session, postMessage };
};

afterEach(() => {
  completedWebCheckout.set(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readCompletedWebCheckout", () => {
  it("keeps the string fields and drops the empty ones", () => {
    expect(
      readCompletedWebCheckout({
        productIdentifier: "test:price_1:no-trial",
        redemptionUrl: "https://redeem.example.com/abc",
        deepLinkUrl: "",
        postCheckoutRequestUrl: "https://api.example.com/post",
      }),
    ).toEqual({
      productIdentifier: "test:price_1:no-trial",
      redemptionUrl: "https://redeem.example.com/abc",
      deepLinkUrl: undefined,
      postCheckoutRequestUrl: "https://api.example.com/post",
    });
    expect(readCompletedWebCheckout(null)).toEqual({
      productIdentifier: undefined,
      redemptionUrl: undefined,
      deepLinkUrl: undefined,
      postCheckoutRequestUrl: undefined,
    });
  });
});

describe("the completed-checkout store", () => {
  it("notifies subscribers when a completion lands", () => {
    const listener = vi.fn();
    const unsubscribe = completedWebCheckout.subscribe(listener);
    completedWebCheckout.set({ redemptionUrl: "https://redeem.example.com/abc" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(completedWebCheckout.get()).toEqual({ redemptionUrl: "https://redeem.example.com/abc" });
    unsubscribe();
    completedWebCheckout.set(undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("resolveCompletedWebCheckout", () => {
  it("asks the post-checkout endpoint for a URL and opens it", async () => {
    completedWebCheckout.set({ postCheckoutRequestUrl: "https://api.example.com/post" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ redirectUrl: "https://app.example.com/welcome" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { session, postMessage } = fakePaywall();

    await resolveCompletedWebCheckout(session, { type: "redeem" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/post");
    expect(JSON.parse(String(init.body))).toEqual({ resolution: { type: "redeem" } });
    expect(init.headers).toMatchObject({ Authorization: "Bearer pk_test" });
    expect(postMessage).toHaveBeenCalledWith({
      event_name: "open_url",
      url: "https://app.example.com/welcome",
    });
  });

  it("omits the auth header when there is no public API key", async () => {
    completedWebCheckout.set({ postCheckoutRequestUrl: "https://api.example.com/post" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ redirectUrl: "https://app.example.com/x" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { session } = fakePaywall(NONE);

    await resolveCompletedWebCheckout(session, { type: "redirect", url: "https://x" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("throws when there is nothing to resolve", async () => {
    const { session } = fakePaywall();
    await expect(resolveCompletedWebCheckout(session, { type: "redeem" })).rejects.toThrow(
      "No completed web checkout to resolve.",
    );
  });

  it("throws when the endpoint returns no URL", async () => {
    completedWebCheckout.set({ postCheckoutRequestUrl: "https://api.example.com/post" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const { session } = fakePaywall();
    await expect(resolveCompletedWebCheckout(session, { type: "redeem" })).rejects.toThrow(
      "The post-checkout endpoint returned no URL.",
    );
  });
});
