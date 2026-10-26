import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuperwallTeleportConfig } from "@superwall/runtime";
import { isLoading, subscribeLoading } from "../../../src/checkout/loading";
import {
  APP_OPEN_WAIT_MS,
  checkoutUrlFor,
  flowQuery,
  openApp,
  pageNavigation,
  teleportFor,
  TELEPORT_TTL_MS,
  type TeleportSession,
} from "../../../src/checkout/teleport/flow";

type Fixture = {
  teleport?: SuperwallTeleportConfig | null;
  device?: Record<string, unknown>;
  postPurchase?: "dismiss" | "stay";
  fallbackPrice?: string;
};

const products = (fallbackPrice: string | undefined) => {
  const list = [
    { reference: "card", productId: "live:price_1:14days-free", variables: {}, source: "inline" },
    {
      reference: "annual",
      productId: "pro_year",
      variables: fallbackPrice === undefined ? {} : { price: fallbackPrice },
      source: "sdk",
    },
  ];
  return {
    products: list,
    productsByReference: Object.fromEntries(list.map((p) => [p.reference, p])),
  };
};

const fakeSession = ({
  teleport = { route: "checkout", fallbacks: { card: "annual" } },
  device = {},
  postPurchase,
  fallbackPrice = "$39.99",
}: Fixture = {}) => {
  const posted: Record<string, unknown>[] = [];
  const session: TeleportSession = {
    getSnapshot: () =>
      ({
        device: {
          platform: "iOS",
          publicApiKey: "pk_test",
          sdkVersionPadded: "004.018.000",
          ...device,
        },
        user: { appUserId: "user_1" },
        params: {},
        ...products(fallbackPrice),
        introductoryOffer: { eligible: false },
        config: { teleport: teleport ?? undefined, postPurchase },
        paywall: { id: "7", identifier: "pw" },
      }) as never,
    postMessage: (message) => posted.push(message),
  };
  return { session, posted, events: () => posted.map((message) => message.event_name) };
};

type Reply = unknown | ((body: unknown) => unknown);

const api = (routes: Record<string, Reply[] | Reply>) => {
  const queues = new Map(
    Object.entries(routes).map(([path, reply]) => [
      path,
      Array.isArray(reply) ? [...reply] : [reply],
    ]),
  );
  const calls: { path: string; body: unknown; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
    const body: unknown = JSON.parse(String(init.body));
    calls.push({ path, body, init });
    const queue = queues.get(path);
    if (queue === undefined || queue.length === 0) throw new Error(`no reply for ${path}`);
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    const value = typeof reply === "function" ? reply(body) : reply;
    return new Response(JSON.stringify(value));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
};

const created = {
  teleportId: "v1:tp",
  url: "https://acme.superwall.app/sw-teleport/v1:tp?sw_doc=x",
};

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setVisibility("visible");
  window.history.replaceState(null, "", "/");
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  Reflect.deleteProperty(window, "showTeleportWaitingScreen");
  Reflect.deleteProperty(window, "handleTeleportReturn");
});

describe("whether a paywall can teleport", () => {
  it("can inside an iOS app on SuperwallKit 4.18 with a key and a teleport route", () => {
    expect(teleportFor(fakeSession().session).available()).toBe(true);
  });

  it("cannot without a route, on Android, on an older SDK, without a key, in the Web SDK or on the web half", () => {
    expect(teleportFor(fakeSession({ teleport: null }).session).available()).toBe(false);
    expect(teleportFor(fakeSession({ device: { platform: "Android" } }).session).available()).toBe(
      false,
    );
    expect(
      teleportFor(fakeSession({ device: { sdkVersionPadded: "004.017.000" } }).session).available(),
    ).toBe(false);
    expect(teleportFor(fakeSession({ device: { publicApiKey: "" } }).session).available()).toBe(
      false,
    );

    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    expect(teleportFor(fakeSession().session).available()).toBe(false);
    window.history.replaceState(null, "", "/");

    Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout" });
    expect(teleportFor(fakeSession().session).available()).toBe(false);
  });
});

describe("a teleport from the app", () => {
  it("creates the teleport, opens it, shows the waiting screen once away, and redeems once paid", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": [
        { status: "pending" },
        {
          status: "completed",
          checkoutContextId: "ctx_1",
          checkoutProductIdentifier: "live:price_1:14days-free",
        },
      ],
    });
    const loading: boolean[] = [];
    const unsubscribe = subscribeLoading((value) => loading.push(value));
    const { session, posted, events } = fakeSession({
      teleport: { route: "checkout", trialEligibility: "always" },
      postPurchase: "stay",
    });
    const teleporter = teleportFor(session);
    const changes = vi.fn();
    teleporter.subscribe(changes);

    const outcome = teleporter.begin({ productReference: "card", query: { goal: "sleep" } });
    await settle();

    expect(loading).toEqual([true, false]);
    expect(isLoading()).toBe(false);
    expect(calls[0]?.path).toBe("checkout/teleport");
    expect(calls[0]?.body).toMatchObject({
      store: "stripe",
      route: "checkout",
      productReference: "card",
      session: { query: { goal: "sleep" } },
      context: {
        paywall: { paywallId: "7" },
        presentment: { isFreeTrialAvailable: true },
        identity: { appUserId: "user_1" },
      },
    });
    expect(events()).toEqual(["stripe_checkout_start", "open_url_external"]);
    expect(posted[0]).toEqual({
      event_name: "stripe_checkout_start",
      checkout_context_id: "v1:tp",
      product_identifier: "live:price_1:14days-free",
    });
    const opened = new URL(String(posted[1]?.url));
    expect(opened.searchParams.get("sw_ref")).toBe("card");
    expect(new URLSearchParams(opened.hash.slice(1)).get("ref")).toBe("card");
    expect(posted[1]).toMatchObject({ teleport: true, waiting_screen: true });
    expect(teleporter.getState()).toMatchObject({
      waiting: true,
      waitingScreen: false,
      productReference: "card",
    });

    setVisibility("hidden");
    expect(teleporter.getState().waitingScreen).toBe(true);
    expect(posted.at(-1)).toMatchObject({
      event_name: "teleport_watch_start",
      teleport_id: "v1:tp",
      public_api_key: "pk_test",
    });
    expect(String(posted.at(-1)?.teleport_status_url)).toContain("checkout/teleport/status");

    await settle(2_000);
    await settle(2_000);

    await expect(outcome).resolves.toBe("completed");
    expect(posted.slice(-2)).toEqual([
      { event_name: "teleport_watch_end" },
      {
        event_name: "stripe_checkout_complete",
        checkout_context_id: "ctx_1",
        product_identifier: "live:price_1:14days-free",
        should_dismiss: false,
      },
    ]);
    expect(teleporter.getState()).toMatchObject({ waiting: false, waitingScreen: false });
    expect(changes).toHaveBeenCalled();
    unsubscribe();
  });

  it("teleports a route with no product and no waiting screen, and waits out the fallback timer for nothing", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "pending" },
    });
    const { session, posted, events } = fakeSession({
      teleport: { route: "plans", overlay: false },
    });
    const teleporter = teleportFor(session);

    void teleporter.begin({ query: {} });
    await settle(1_500);

    expect(calls[0]?.body).not.toHaveProperty("productReference");
    expect(calls[0]?.body).toMatchObject({
      context: { presentment: { isFreeTrialAvailable: false } },
    });
    expect(events()).toEqual(["open_url_external"]);
    expect(posted[0]).not.toHaveProperty("waiting_screen");
    expect(new URL(String(posted[0]?.url)).searchParams.has("sw_ref")).toBe(false);
    expect(teleporter.getState().waitingScreen).toBe(false);
    expect(teleporter.showWaitingScreen()).toBe(false);
  });

  it("shows the waiting screen on its own after a moment, or at once when the SDK asks", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const first = fakeSession();
    void teleportFor(first.session).begin({ productReference: "card", query: {} });
    await settle(1_500);
    expect(teleportFor(first.session).getState().waitingScreen).toBe(true);

    const second = fakeSession();
    void teleportFor(second.session).begin({ productReference: "card", query: {} });
    await settle();
    const show = Reflect.get(window, "showTeleportWaitingScreen");
    await expect(show()).resolves.toBe(true);
    expect(teleportFor(second.session).getState().waitingScreen).toBe(true);
    expect(teleportFor(second.session).showWaitingScreen()).toBe(true);
  });

  it("names no product to the SDK for a reference the store never delivered", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const { session, events } = fakeSession();
    void teleportFor(session).begin({ productReference: "missing", query: {} });
    await settle();
    expect(events()).toEqual(["open_url_external"]);
  });

  it("is a failed purchase when the teleport cannot be created, and nothing without a route", async () => {
    api({ "checkout/teleport": new Response("{}", { status: 422 }) });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { session, events } = fakeSession();

    await expect(teleportFor(session).begin({ productReference: "card", query: {} })).resolves.toBe(
      "failed",
    );
    expect(error).toHaveBeenCalledWith("Opening the web checkout failed:", expect.any(Error));
    expect(events()).toEqual([]);
    expect(isLoading()).toBe(false);

    await expect(
      teleportFor(fakeSession({ teleport: null }).session).begin({ query: {} }),
    ).resolves.toBe("failed");
  });

  it("refuses a create answer without an id or link", async () => {
    api({ "checkout/teleport": { teleportId: "v1:tp" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(teleportFor(fakeSession().session).begin({ query: {} })).resolves.toBe("failed");
  });

  it("redeems a checkout the teleport page bound once Stripe says it is paid", async () => {
    api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "claimed", checkoutContextId: "ctx_2" },
      "checkout/status": [{ status: "pending" }, { status: "completed" }],
    });
    const { session, posted } = fakeSession();
    const outcome = teleportFor(session).begin({ productReference: "card", query: {} });
    await settle();
    await settle(2_000);
    await settle(2_000);

    await expect(outcome).resolves.toBe("completed");
    expect(posted.at(-1)).toEqual({
      event_name: "stripe_checkout_complete",
      checkout_context_id: "ctx_2",
      product_identifier: "live:price_1:14days-free",
    });
  });

  it("abandons an expired teleport", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "expired" } });
    const { session, posted } = fakeSession();
    const outcome = teleportFor(session).begin({ productReference: "card", query: {} });
    await settle();
    await settle(2_000);

    await expect(outcome).resolves.toBe("abandoned");
    expect(posted.at(-1)).toEqual({
      event_name: "stripe_checkout_abandon",
      checkout_context_id: "v1:tp",
      product_identifier: "live:price_1:14days-free",
    });
  });

  it("keeps checking through failures, slows down after two minutes, and gives up at the time limit", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": [new Error("offline"), { status: "weird" }],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { session } = fakeSession();
    const outcome = teleportFor(session).begin({ productReference: "card", query: {} });
    await settle();
    await settle(2_000);
    expect(warn).toHaveBeenCalledWith(
      "Checking the web checkout failed; retrying:",
      expect.any(Error),
    );

    const at = calls.length;
    await settle(2 * 60 * 1000);
    const fast = calls.length - at;
    await settle(60 * 1000);
    expect(calls.length - at - fast).toBeLessThanOrEqual(13);

    await settle(TELEPORT_TTL_MS);
    await expect(outcome).resolves.toBe("abandoned");
  });

  it("waits twice as long once the web page has bound a checkout", async () => {
    api({
      "checkout/teleport": created,
      "checkout/teleport/status": {
        status: "claimed",
        checkoutContextId: "ctx_3",
        checkoutProductIdentifier: "live:price_1:no-trial",
      },
      "checkout/status": { status: "pending" },
    });
    const { session, posted } = fakeSession();
    const outcome = teleportFor(session).begin({ productReference: "card", query: {} });
    let done = false;
    void outcome.then(() => (done = true));
    await settle();
    await settle(TELEPORT_TTL_MS + 10_000);
    expect(done).toBe(false);
    await settle(TELEPORT_TTL_MS);
    await expect(outcome).resolves.toBe("abandoned");
    expect(posted.at(-1)).toMatchObject({ checkout_context_id: "ctx_3" });
  });

  it("checks at once when the shopper returns, and abandons once still unpaid after the grace", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const { session, posted } = fakeSession();
    const handleReturn = () => Reflect.get(window, "handleTeleportReturn")();
    const outcome = teleportFor(session).begin({ productReference: "card", query: {} });
    await settle(1_500);

    await expect(handleReturn()).resolves.toBe(true);
    expect(posted.at(-1)).toEqual({ event_name: "teleport_watch_end" });
    await expect(handleReturn()).resolves.toBe(false);
    await settle(2_000);
    await settle(16_000);

    await expect(outcome).resolves.toBe("abandoned");
    await expect(handleReturn()).resolves.toBe(false);
  });

  it("keeps checking after a return while the status cannot be read", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": [new Error("offline")] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { session } = fakeSession();
    const outcome = teleportFor(session).begin({ productReference: "card", query: {} });
    let done = false;
    void outcome.then(() => (done = true));
    await settle();
    teleportFor(session).handleReturn();
    await settle(30_000);
    expect(done).toBe(false);
  });

  it("reopens the browser, cancels, and starts over when tapped again", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const { session, posted, events } = fakeSession();
    const teleporter = teleportFor(session);
    teleporter.reopen();
    teleporter.cancel();
    expect(events()).toEqual([]);

    const first = teleporter.begin({ productReference: "card", query: {} });
    await settle();
    teleporter.reopen();
    expect(posted.at(-1)).toMatchObject({ event_name: "open_url_external", teleport: true });
    expect(posted.at(-1)).not.toHaveProperty("waiting_screen");

    const second = teleporter.begin({ productReference: "card", query: {} });
    await expect(first).resolves.toBe("abandoned");
    await settle();
    teleporter.cancel();
    await expect(second).resolves.toBe("abandoned");
  });

  it("buys the fallback in the app instead, once the store priced it", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const { session } = fakeSession();
    const teleporter = teleportFor(session);
    expect(teleporter.fallback()).toBeUndefined();
    teleporter.payInApp();

    const outcome = teleporter.begin({ productReference: "card", query: {} });
    await settle();
    expect(teleporter.fallback()).toBe("annual");
    teleporter.payInApp();
    await expect(outcome).resolves.toEqual({ fallback: "annual" });
    expect(teleporter.getState().waiting).toBe(false);
  });

  it("offers no fallback the store hasn't priced, nor for a product without one", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const unpriced = teleportFor(fakeSession({ fallbackPrice: "" }).session);
    void unpriced.begin({ productReference: "card", query: {} });
    await settle();
    expect(unpriced.fallback()).toBeUndefined();
    unpriced.payInApp();
    expect(unpriced.getState().waiting).toBe(true);

    const bare = teleportFor(fakeSession({ teleport: { route: "checkout" } }).session);
    void bare.begin({ productReference: "card", query: {} });
    await settle();
    expect(bare.fallback()).toBeUndefined();

    const routeOnly = teleportFor(fakeSession().session);
    void routeOnly.begin({ query: {} });
    await settle();
    expect(routeOnly.fallback()).toBeUndefined();

    const missing = teleportFor(
      fakeSession({ teleport: { route: "checkout", fallbacks: { card: "gone" } } }).session,
    );
    void missing.begin({ productReference: "card", query: {} });
    await settle();
    expect(missing.fallback()).toBeUndefined();
  });

  it("drops a status answer that arrives after the teleport was settled", async () => {
    let answer: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("checkout/teleport")) return new Response(JSON.stringify(created));
        return new Promise<Response>((resolve) => (answer = resolve));
      }),
    );
    const { session, events } = fakeSession();
    const teleporter = teleportFor(session);
    const outcome = teleporter.begin({ productReference: "card", query: {} });
    await settle(2_000);
    teleporter.cancel();
    answer(new Response(JSON.stringify({ status: "completed", checkoutContextId: "ctx" })));
    await settle();
    await expect(outcome).resolves.toBe("abandoned");
    expect(events()).not.toContain("stripe_checkout_complete");
  });

  it("drops a checkout answer that arrives after the teleport was settled", async () => {
    let answer: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("checkout/teleport")) return new Response(JSON.stringify(created));
        if (url.endsWith("checkout/teleport/status")) {
          return new Response(JSON.stringify({ status: "claimed", checkoutContextId: "ctx" }));
        }
        return new Promise<Response>((resolve) => (answer = resolve));
      }),
    );
    const { session, events } = fakeSession();
    const teleporter = teleportFor(session);
    const outcome = teleporter.begin({ productReference: "card", query: {} });
    await settle(2_000);
    teleporter.cancel();
    answer(new Response(JSON.stringify({ status: "completed" })));
    await settle();
    await expect(outcome).resolves.toBe("abandoned");
    expect(events()).not.toContain("stripe_checkout_complete");
  });

  it("drops a failed check that arrives after the teleport was settled", async () => {
    let fail: (error: Error) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("checkout/teleport")) return new Response(JSON.stringify(created));
        return new Promise<Response>((_, reject) => (fail = reject));
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { session } = fakeSession();
    const teleporter = teleportFor(session);
    void teleporter.begin({ productReference: "card", query: {} });
    await settle(2_000);
    teleporter.cancel();
    fail(new Error("late"));
    await settle(10_000);
    expect(teleporter.getState().waiting).toBe(false);
  });
});

describe("the web half of a teleport", () => {
  const boot = (over: Record<string, unknown> = {}) =>
    Reflect.set(window, "__SW_TELEPORT__", {
      id: "v1:tp",
      route: "checkout",
      returnUrl: "myapp://superwall/return",
      appLinkUrl: "https://acme.superwall.link/app-link/superwall/return",
      ...over,
    });

  it("binds the purchase, then shows the success screen", async () => {
    boot();
    const calls = api({ "checkout/session/complete": {} });
    const teleporter = teleportFor(fakeSession().session);

    await teleporter.completePurchase("ctx_9");

    expect(calls[0]).toMatchObject({
      path: "checkout/session/complete",
      body: { checkoutContextId: "ctx_9" },
    });
    expect(calls[0]?.init.keepalive).toBe(true);
    expect(teleporter.getState().completed).toBe(true);
  });

  it("opens the app through its scheme for an alert, and through the universal link otherwise", async () => {
    boot();
    api({ "checkout/session/complete": {} });
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);

    await teleportFor(
      fakeSession({ teleport: { route: "checkout", returnStyle: "alert" } }).session,
    ).completePurchase("ctx");
    expect(go).toHaveBeenLastCalledWith("myapp://superwall/return?reason=purchased");

    await teleportFor(
      fakeSession({ teleport: { route: "checkout", returnStyle: "universal" } }).session,
    ).completePurchase("ctx");
    expect(go).toHaveBeenLastCalledWith(
      "https://acme.superwall.link/app-link/superwall/return?reason=purchased",
    );
    await settle(APP_OPEN_WAIT_MS);
    expect(go).toHaveBeenLastCalledWith("myapp://superwall/return?reason=purchased");
  });

  it("logs a completion that never reaches the backend and still finishes", async () => {
    boot();
    api({ "checkout/session/complete": new Error("offline") });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const teleporter = teleportFor(fakeSession().session);
    await teleporter.completePurchase("ctx");
    expect(error).toHaveBeenCalledWith(
      "Completing the teleport checkout failed:",
      expect.any(Error),
    );
    expect(teleporter.getState().completed).toBe(true);
  });

  it("returns to the app through the link the paywall asks for", () => {
    boot();
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    teleportFor(
      fakeSession({ teleport: { route: "checkout", appLink: "scheme" } }).session,
    ).returnToApp("closed");
    expect(go).toHaveBeenLastCalledWith("myapp://superwall/return?reason=closed");
    teleportFor(fakeSession().session).returnToApp();
    expect(go).toHaveBeenLastCalledWith("https://acme.superwall.link/app-link/superwall/return");
  });

  it("stays when the app opened from the universal link", async () => {
    boot();
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    teleportFor(fakeSession().session).returnToApp("closed");
    setVisibility("hidden");
    await settle(APP_OPEN_WAIT_MS);
    expect(go).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    teleportFor(fakeSession().session).returnToApp("closed");
    window.dispatchEvent(new Event("pagehide"));
    await settle(APP_OPEN_WAIT_MS);
    expect(go).toHaveBeenCalledTimes(2);

    teleportFor(fakeSession().session).returnToApp("closed");
    setVisibility("hidden");
    setVisibility("visible");
    await settle(APP_OPEN_WAIT_MS);
    expect(go).toHaveBeenCalledTimes(3);
  });

  it("does nothing without a way back, off the web half, or without a teleport", async () => {
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    teleportFor(fakeSession().session).returnToApp();
    await teleportFor(fakeSession().session).completePurchase("ctx");
    boot({ returnUrl: undefined, appLinkUrl: undefined });
    teleportFor(fakeSession().session).returnToApp();
    teleportFor(fakeSession({ teleport: null }).session).returnToApp();
    await teleportFor(fakeSession({ teleport: null }).session).completePurchase("ctx");
    expect(go).not.toHaveBeenCalled();
  });

  it("goes straight to a universal link that is the scheme itself", () => {
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    openApp({ id: "v1", route: "r", returnUrl: "myapp://x", query: {} }, "universal");
    openApp(
      { id: "v1", route: "r", appLinkUrl: "https://a.superwall.link/x", query: {} },
      "universal",
    );
    expect(go.mock.calls).toEqual([["myapp://x"], ["https://a.superwall.link/x"]]);
  });

  it("navigates the page itself", () => {
    pageNavigation.assign("#teleport");
    expect(window.location.hash).toBe("#teleport");
  });
});

describe("the link and the flow state", () => {
  it("keeps a tapped product already in the link, and names none for a route", () => {
    const url = new URL(checkoutUrlFor("https://a.app/sw-teleport/1?sw_ref=first", "second"));
    expect(url.searchParams.get("sw_ref")).toBe("first");
    expect(new URLSearchParams(url.hash.slice(1)).get("ref")).toBe("second");
    expect(
      new URLSearchParams(new URL(checkoutUrlFor("https://a.app/x", undefined)).hash.slice(1)).has(
        "ref",
      ),
    ).toBe(false);
  });

  it("carries every query value but the stack", () => {
    expect(flowQuery({ entries: () => ({ sw_nav: "index,goal", goal: "sleep" }) })).toEqual({
      goal: "sleep",
    });
    expect(flowQuery(null)).toEqual({});
  });
});
