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
  restoreTeleportQuery,
} from "../../../src/checkout/teleport/flow";
import { warmTeleportPage } from "../../../src/checkout/teleport/api";

type Fixture = {
  teleport?: SuperwallTeleportConfig | null;
  trial?: { eligible: boolean };
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
  trial = { eligible: false },
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
        introductoryOffer: trial,
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
  const warmed: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === "GET") {
      warmed.push(url);
      return new Response(null, { status: 204 });
    }
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
  return Object.assign(calls, { warmed });
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

const handleReturn = () => Reflect.get(window, "handleTeleportReturn")();

const boot = (over: Record<string, unknown> = {}) =>
  Reflect.set(window, "__SW_TELEPORT__", {
    id: "v1:tp",
    route: "checkout",
    returnUrl: "myapp://superwall/return",
    appLinkUrl: "https://acme.superwall.link/app-link/superwall/return",
    ...over,
  });

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
      teleport: { route: "checkout", introductoryOfferEligibility: "eligible" },
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
    expect(teleporter.getStatus()).toEqual({ status: "idle" });

    setVisibility("hidden");
    expect(teleporter.getStatus()).toEqual({ status: "waiting", productReference: "card" });
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
    expect(teleporter.getStatus()).toEqual({ status: "idle" });
    expect(changes).toHaveBeenCalled();
    unsubscribe();
  });

  it("teleports a route with no product and no screen of its own, still waiting on the screen's timing", async () => {
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
    expect(events()).toEqual(["open_url_external", "teleport_watch_start"]);
    expect(posted[0]).not.toHaveProperty("waiting_screen");
    expect(new URL(String(posted[0]?.url)).searchParams.has("sw_ref")).toBe(false);
    expect(teleporter.getStatus()).toEqual({ status: "waiting" });
    expect(teleporter.showWaitingScreen()).toBe(false);
  });

  it("starts waiting on its own after a moment, or at once when the SDK asks", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const first = fakeSession();
    void teleportFor(first.session).begin({ productReference: "card", query: {} });
    await settle(1_500);
    expect(teleportFor(first.session).getStatus().status).toBe("waiting");

    const second = fakeSession();
    void teleportFor(second.session).begin({ productReference: "card", query: {} });
    await settle();
    const show = Reflect.get(window, "showTeleportWaitingScreen");
    await expect(show()).resolves.toBe(true);
    expect(teleportFor(second.session).getStatus().status).toBe("waiting");
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
    expect(posted.at(-1)).toMatchObject({
      event_name: "open_url_external",
      teleport: true,
      waiting_screen: true,
    });

    const second = teleporter.begin({ productReference: "card", query: {} });
    await expect(first).resolves.toBe("abandoned");
    await settle();
    teleporter.cancel();
    await expect(second).resolves.toBe("abandoned");
  });

  it("hands a second tap made while the teleport is being created the same purchase", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": [
        { status: "pending" },
        { status: "completed", checkoutContextId: "ctx_1" },
      ],
    });
    const { session, events } = fakeSession();
    const teleporter = teleportFor(session);

    const first = teleporter.begin({ productReference: "card", query: {} });
    const second = teleporter.begin({ productReference: "card", query: {} });
    expect(second).toBe(first);
    await settle();
    await settle(2_000);
    await settle(2_000);

    await expect(first).resolves.toBe("completed");
    expect(calls.filter((call) => call.path === "checkout/teleport")).toHaveLength(1);
    expect(events().filter((name) => name === "open_url_external")).toHaveLength(1);

    const third = teleporter.begin({ productReference: "card", query: {} });
    expect(third).not.toBe(first);
    await settle();
    teleporter.cancel();
    await expect(third).resolves.toBe("abandoned");
  });

  it("finishes with the purchase's own postPurchase and writes its Stripe metadata", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "completed", checkoutContextId: "ctx_1" },
      "checkout/session/custom-metadata": {},
    });
    const { session, posted } = fakeSession({ postPurchase: "dismiss" });

    const outcome = teleportFor(session).begin({
      productReference: "card",
      query: {},
      postPurchase: "stay",
      stripeMetadata: { quiz: "q1" },
    });
    await settle();
    await settle(2_000);

    await expect(outcome).resolves.toBe("completed");
    expect(posted.at(-1)).toMatchObject({
      event_name: "stripe_checkout_complete",
      should_dismiss: false,
    });
    expect(calls.find((call) => call.path === "checkout/session/custom-metadata")?.body).toEqual({
      checkoutContextId: "ctx_1",
      metadata: { quiz: "q1" },
      timing: "post_purchase",
    });
  });

  it("logs Stripe metadata that cannot be written and still completes", async () => {
    api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "completed", checkoutContextId: "ctx_1" },
      "checkout/session/custom-metadata": new Response("nope", { status: 400 }),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { session } = fakeSession();

    const outcome = teleportFor(session).begin({
      productReference: "card",
      query: {},
      stripeMetadata: { quiz: "q1" },
    });
    await settle();
    await settle(2_000);

    await expect(outcome).resolves.toBe("completed");
    expect(error).toHaveBeenCalledWith("Attaching checkout metadata failed:", expect.any(Error));
  });

  it("forgets a return once the shopper reopens the browser, so the grace starts on the next one", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const { session } = fakeSession();
    const teleporter = teleportFor(session);
    const outcome = teleporter.begin({ productReference: "card", query: {} });
    let done = false;
    void outcome.then(() => (done = true));
    await settle();

    teleporter.handleReturn();
    await settle(5_000);
    teleporter.reopen();
    await settle(30_000);
    expect(done).toBe(false);

    teleporter.handleReturn();
    await settle(20_000);
    await expect(outcome).resolves.toBe("abandoned");
  });

  it("hands the purchase to an in-app one bought while it is in flight, once the store priced the fallback", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const { session, events } = fakeSession();
    const teleporter = teleportFor(session);
    expect(teleporter.fallback()).toBeUndefined();
    expect(teleporter.inFlight()).toBe(false);
    teleporter.handOff("annual", Promise.resolve({ status: "completed" as const }));

    const outcome = teleporter.begin({ productReference: "card", query: {} });
    await settle(1_500);
    expect(teleporter.fallback()).toBe("annual");
    expect(teleporter.inFlight()).toBe(true);
    const bought = Promise.resolve({ status: "completed" as const });
    teleporter.handOff("annual", bought);
    await expect(outcome).resolves.toEqual({ reference: "annual", result: bought });
    expect(teleporter.getStatus()).toEqual({ status: "idle" });
    expect(teleporter.inFlight()).toBe(false);
    expect(events()).not.toContain("stripe_checkout_abandon");
  });

  it("offers no fallback the store hasn't priced, nor for a product without one", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const unpriced = teleportFor(fakeSession({ fallbackPrice: "" }).session);
    void unpriced.begin({ productReference: "card", query: {} });
    await settle();
    expect(unpriced.fallback()).toBeUndefined();

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
    let answer: ((value: Response) => void) | undefined;
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
    answer?.(new Response(JSON.stringify({ status: "completed", checkoutContextId: "ctx" })));
    await settle();
    await expect(outcome).resolves.toBe("abandoned");
    expect(events()).not.toContain("stripe_checkout_complete");
  });

  it("drops a checkout answer that arrives after the teleport was settled", async () => {
    let answer: ((value: Response) => void) | undefined;
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
    answer?.(new Response(JSON.stringify({ status: "completed" })));
    await settle();
    await expect(outcome).resolves.toBe("abandoned");
    expect(events()).not.toContain("stripe_checkout_complete");
  });

  it("drops a failed check that arrives after the teleport was settled", async () => {
    let fail: ((error: Error) => void) | undefined;
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
    fail?.(new Error("late"));
    await settle(10_000);
    expect(teleporter.getStatus()).toEqual({ status: "idle" });
  });
});

const fragmentOf = (message: Record<string, unknown> | undefined) =>
  new URLSearchParams(new URL(String(message?.url)).hash.slice(1));

const patchOf = (message: Record<string, unknown> | undefined): unknown => {
  const encoded = fragmentOf(message).get("s");
  if (encoded === null) return undefined;
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
};

describe("a prepared teleport", () => {
  const second = { teleportId: "v1:tp2", url: "https://acme.superwall.app/sw-teleport/v1:tp2" };

  it("is created ahead of the tap with no product, warms the page per Stripe product, and opens at once", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "pending" },
    });
    const { session, posted } = fakeSession();
    const teleporter = teleportFor(session);

    teleporter.prefetch(undefined, { goal: "sleep" });
    teleporter.prefetch();
    await settle();

    expect(calls.filter((call) => call.path === "checkout/teleport")).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      route: "checkout",
      session: { query: { goal: "sleep" } },
    });
    expect(calls[0]?.body).not.toHaveProperty("productReference");
    expect(calls.warmed).toEqual([
      "https://acme.superwall.app/sw-teleport/v1:tp?sw_doc=x&sw_warm=1&sw_ref=card",
    ]);

    const outcome = teleporter.begin({ productReference: "card", query: { goal: "sleep" } });
    let done = false;
    void outcome.then(() => (done = true));
    await settle();

    expect(calls.filter((call) => call.path === "checkout/teleport")).toHaveLength(1);
    expect(fragmentOf(posted.at(-1)).get("ref")).toBe("card");
    expect(patchOf(posted.at(-1))).toBeUndefined();
    expect(done).toBe(false);
    teleporter.cancel();
  });

  it("carries the flow that changed since it was prepared in the link, or saves it when too long", async () => {
    const calls = api({
      "checkout/teleport": [created, second],
      "checkout/teleport/status": { status: "pending" },
      "checkout/teleport/session": { saved: true },
    });
    const { session, posted } = fakeSession();
    const teleporter = teleportFor(session);

    teleporter.prefetch(undefined, { goal: "sleep", level: "1" });
    await settle();
    void teleporter.begin({ productReference: "card", query: { goal: "focus", level: "1" } });
    await settle();
    expect(patchOf(posted.at(-1))).toEqual({ query: { goal: "focus" } });
    teleporter.cancel();

    teleporter.prefetch();
    await settle();
    const long = { essay: "x".repeat(3_000) };
    void teleporter.begin({ productReference: "card", query: long });
    await settle();
    expect(patchOf(posted.at(-1))).toBeUndefined();
    expect(calls.find((call) => call.path === "checkout/teleport/session")?.body).toEqual({
      teleportId: "v1:tp2",
      session: { query: long },
    });
    teleporter.cancel();
  });

  it("saves the whole flow when an answer was cleared since it was prepared, so the page never brings it back", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "pending" },
      "checkout/teleport/session": { saved: true },
    });
    const { session, posted } = fakeSession();
    const teleporter = teleportFor(session);

    teleporter.prefetch(undefined, { goal: "sleep", level: "1" });
    await settle();
    void teleporter.begin({ productReference: "card", query: { level: "1" } });
    await settle();

    expect(patchOf(posted.at(-1))).toBeUndefined();
    expect(calls.find((call) => call.path === "checkout/teleport/session")?.body).toEqual({
      teleportId: "v1:tp",
      session: { query: { level: "1" } },
    });
    teleporter.cancel();
  });

  it("carries the changed flow again every time the shopper reopens the browser", async () => {
    api({ "checkout/teleport": created, "checkout/teleport/status": { status: "pending" } });
    const { session, posted } = fakeSession();
    const teleporter = teleportFor(session);

    teleporter.prefetch(undefined, { goal: "sleep" });
    await settle();
    void teleporter.begin({ productReference: "card", query: { goal: "focus" } });
    await settle();
    teleporter.reopen();

    expect(posted.at(-1)).toMatchObject({ event_name: "open_url_external" });
    expect(patchOf(posted.at(-1))).toEqual({ query: { goal: "focus" } });
    teleporter.cancel();
  });

  it("opens with what it had when the flow cannot be saved", async () => {
    api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "pending" },
      "checkout/teleport/session": new Response("no", { status: 400 }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { session, events } = fakeSession();
    const teleporter = teleportFor(session);
    teleporter.prefetch();
    await settle();
    void teleporter.begin({ productReference: "card", query: { essay: "x".repeat(3_000) } });
    await settle();
    expect(warn).toHaveBeenCalledWith(
      "Saving the flow on the teleport failed; the page opens with what it had:",
      expect.any(Error),
    );
    expect(events()).toContain("open_url_external");
    teleporter.cancel();
  });

  it("is not used for another route, once stale, or once the trial offer changed", async () => {
    const calls = api({
      "checkout/teleport": [created, second, created, second, created],
      "checkout/teleport/status": { status: "pending" },
    });
    const trial = { eligible: false };
    const { session } = fakeSession({ trial });
    const teleporter = teleportFor(session);
    const creates = () => calls.filter((call) => call.path === "checkout/teleport").length;

    teleporter.prefetch();
    await settle();
    void teleporter.begin({ route: "plans", query: {} });
    await settle();
    expect(creates()).toBe(2);
    teleporter.cancel();

    teleporter.prefetch();
    await settle(10 * 60 * 1000);
    void teleporter.begin({ productReference: "card", query: {} });
    await settle();
    expect(creates()).toBe(4);
    teleporter.cancel();

    trial.eligible = true;
    teleporter.prefetch();
    await settle();
    expect(creates()).toBe(5);
    teleporter.cancel();
  });

  it("is created again on the tap when the trial offer changed since, and warms one page with no Stripe product", async () => {
    const calls = api({
      "checkout/teleport": [created, second],
      "checkout/teleport/status": { status: "pending" },
    });
    const trial = { eligible: false };
    const { session } = fakeSession({ trial });
    const teleporter = teleportFor(session);
    teleporter.prefetch();
    await settle();
    trial.eligible = true;
    void teleporter.begin({ productReference: "card", query: {} });
    await settle();
    expect(calls.filter((call) => call.path === "checkout/teleport")).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({
      context: { presentment: { isFreeTrialAvailable: true } },
    });
    teleporter.cancel();

    warmTeleportPage("https://acme.superwall.app/sw-teleport/v1:tp", []);
    expect(calls.warmed.at(-1)).toBe("https://acme.superwall.app/sw-teleport/v1:tp?sw_warm=1");
  });

  it("prepares a route the app pushes with teleport, and refreshes one prepared under another trial offer", async () => {
    const calls = api({
      "checkout/teleport": [created, second],
      "checkout/teleport/status": { status: "pending" },
    });
    const trial = { eligible: false };
    const { session } = fakeSession({ trial, teleport: true });
    const teleporter = teleportFor(session);

    teleporter.prefetch();
    expect(calls).toHaveLength(0);

    teleporter.prefetch("plans");
    await settle();
    expect(calls[0]?.body).toMatchObject({ route: "plans" });

    trial.eligible = true;
    teleporter.prefetch("plans");
    await settle();
    expect(calls[1]?.body).toMatchObject({
      route: "plans",
      context: { presentment: { isFreeTrialAvailable: true } },
    });
  });

  it("does nothing where teleport can't run, and falls back to a tap-time teleport when preparing failed", async () => {
    const calls = api({
      "checkout/teleport": [new Response("{}", { status: 422 }), created],
      "checkout/teleport/status": { status: "pending" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    teleportFor(fakeSession({ device: { platform: "Android" } }).session).prefetch();
    teleportFor(fakeSession({ teleport: null }).session).prefetch("plans");
    expect(calls).toHaveLength(0);

    const { session, events } = fakeSession();
    const teleporter = teleportFor(session);
    teleporter.prefetch();
    await settle();
    expect(warn).toHaveBeenCalledWith(
      "Preparing the teleport failed; a tap creates one instead:",
      expect.any(Error),
    );
    void teleporter.begin({ productReference: "card", query: {} });
    await settle();
    expect(calls.filter((call) => call.path === "checkout/teleport")).toHaveLength(2);
    expect(events()).toContain("open_url_external");
    teleporter.cancel();
  });
});

describe("which route a teleport opens", () => {
  it("is the one asked for, then the paywall's, then the route the shopper is on, and fails without any", async () => {
    const calls = api({
      "checkout/teleport": created,
      "checkout/teleport/status": { status: "pending" },
    });
    const { session } = fakeSession({ teleport: { introductoryOfferEligibility: "ineligible" } });
    const teleporter = teleportFor(session);

    await expect(teleporter.begin({ productReference: "card", query: {} })).resolves.toBe("failed");
    expect(calls).toHaveLength(0);

    teleporter.landed("pricing");
    void teleporter.begin({ productReference: "card", query: {} });
    await settle();
    expect(calls[0]?.body).toMatchObject({
      route: "pricing",
      context: { presentment: { isFreeTrialAvailable: false } },
    });
    teleporter.cancel();
  });
});

describe("the web half of a teleport", () => {
  it("arrives with the product tapped in the app, binds the purchase, then completes", async () => {
    boot({ productReference: "card" });
    const calls = api({ "checkout/session/complete": {} });
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    const teleporter = teleportFor(fakeSession().session);
    expect(teleporter.getStatus()).toEqual({ status: "arrived", productReference: "card" });

    await teleporter.completePurchase("ctx_9");

    expect(calls[0]).toMatchObject({
      path: "checkout/session/complete",
      body: { checkoutContextId: "ctx_9" },
    });
    expect(calls[0]?.init.keepalive).toBe(true);
    expect(teleporter.getStatus()).toEqual({ status: "completed", productReference: "card" });
    expect(go).not.toHaveBeenCalled();
  });

  it("follows a product the app swaps in through the link's fragment", () => {
    boot();
    const teleporter = teleportFor(fakeSession().session);
    expect(teleporter.getStatus()).toEqual({ status: "arrived" });
    window.location.hash = "#ref=annual";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(teleporter.getStatus()).toEqual({ status: "arrived", productReference: "annual" });
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.location.hash = "#o=1";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(teleporter.getStatus()).toEqual({ status: "arrived", productReference: "annual" });
  });

  it("opens the app at once for a direct completion, through the universal link and then the scheme", async () => {
    boot();
    api({ "checkout/session/complete": {} });
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);

    const teleporter = teleportFor(
      fakeSession({ teleport: { route: "checkout", completion: "direct" } }).session,
    );
    await teleporter.completePurchase("ctx");
    expect(teleporter.getStatus()).toEqual({ status: "completed" });
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
    expect(teleporter.getStatus()).toEqual({ status: "completed" });
  });

  it("returns to the app through the universal link, or the scheme when there is no link", () => {
    boot({ appLinkUrl: undefined });
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    teleportFor(fakeSession().session).returnToApp("closed");
    expect(go).toHaveBeenLastCalledWith("myapp://superwall/return?reason=closed");
    boot();
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
    openApp({ id: "v1", route: "r", returnUrl: "myapp://x", query: {}, loadSession: false });
    openApp({
      id: "v1",
      route: "r",
      appLinkUrl: "https://a.superwall.link/x",
      query: {},
      loadSession: false,
    });
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

describe("the flow the app saved for a teleport", () => {
  const linkBoot = { id: "v1:tp", route: "checkout", query: {}, loadSession: true };

  it("fills in the answers the page doesn't have yet, and leaves the ones it has", async () => {
    const calls = api({
      "checkout/teleport/session/read": {
        session: { query: { goal: "sleep", level: "new", sw_nav: "index" } },
      },
    });
    const writes: unknown[] = [];
    const store = {
      get: (key: string) => (key === "level" ? "old" : null),
      set: (patch: Record<string, string>) => writes.push(patch),
    };

    await restoreTeleportQuery(linkBoot, "pk_test", store);

    expect(calls[0]).toMatchObject({
      path: "checkout/teleport/session/read",
      body: { teleportId: "v1:tp" },
    });
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer pk_test" });
    expect(writes).toEqual([{ goal: "sleep" }]);
  });

  it("writes nothing when the saved flow adds nothing", async () => {
    api({ "checkout/teleport/session/read": {} });
    const set = vi.fn();
    await restoreTeleportQuery(linkBoot, "pk_test", { get: () => null, set });
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps the page as it is when the saved flow cannot be read", async () => {
    api({ "checkout/teleport/session/read": new Response("{}", { status: 404 }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const set = vi.fn();
    await restoreTeleportQuery(linkBoot, "pk_test", { get: () => null, set });
    expect(set).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Reading the flow the app saved for this teleport failed:",
      expect.any(Error),
    );
  });
});
