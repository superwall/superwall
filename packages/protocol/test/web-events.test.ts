// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTransport,
  TransportKind,
  WebSdkEvents,
  webSdkEventsInit,
  WebSdkTransport,
  type TOutgoingMessage,
  type WebSdkEventsInit,
} from "../src";

type Published = { event_id: string; event_name: string; parameters: Record<string, unknown> };

const COLLECTOR = {
  url: "https://web-api.superwall.app/api/proxy/events",
  headers: {
    "x-public-api-key": "pk_web",
    "x-alias-id": "$SuperwallAlias:a1",
    "x-device-id": "$SuperwallDevice:d1",
    "x-platform": "web",
    "x-dropped": 7,
  },
  placementEventId: "placement-event-1",
  identity: { userId: { type: "appUserId", appUserId: "user_1" }, deviceId: "d1" },
  userAttributes: { email: "ada@example.com" },
  deviceAttributes: { $appInstallDate: "2026-01-01T00:00:00.000Z" },
  experimentSlice: { $experiment_id: "e1", $variant_id: "v1" },
  paywallSlice: { $paywall_id: "271256", $paywall_identifier: "paywall-simple-v2" },
  productSlice: { annual: { $product_period: "year" } },
  presentmentSlice: { $presented_by_event_name: "web_checkout", $presented_by: "placement" },
  placementParamsSlice: { $placement_params: { source: "result" } },
};

const encode = (payload: unknown) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))));

const hashOf = (payload: unknown) => `#init=${encode(payload)}`;

const PAYLOAD = {
  apiBase: "https://web-api.superwall.app",
  clientSurface: "web-sdk",
  hostOrigin: "http://localhost:5175",
  checkoutContext: {
    managedPayments: true,
    paywallManagedPaymentsOverride: "USE_MANAGED_PAYMENTS",
  },
  collector: COLLECTOR,
};

const initOf = (payload: unknown = PAYLOAD, search = "?sdk_version=0.2.9"): WebSdkEventsInit => {
  const init = webSdkEventsInit(hashOf(payload), search);
  if (!init) throw new Error("expected an init payload");
  return init;
};

let fetchMock: ReturnType<typeof vi.fn>;

const published = (): Published[] =>
  fetchMock.mock.calls.flatMap(([, request]) => JSON.parse(String(request.body)).events);

const names = () => published().map((event) => event.event_name);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
  delete (window as Window & { __SW_EVENTS_DISABLED__?: boolean }).__SW_EVENTS_DISABLED__;
});

describe("webSdkEventsInit", () => {
  it("reads the collector and the surface paywall.js stamps on every event", () => {
    const init = initOf();

    expect(init).toMatchObject({
      clientSurface: "web-sdk",
      hostOrigin: "http://localhost:5175",
      sdkVersion: "0.2.9",
      managedPayments: true,
      paywallManagedPaymentsOverride: "USE_MANAGED_PAYMENTS",
    });
    expect(init.collector.url).toBe(COLLECTOR.url);
    expect(init.collector.headers).not.toHaveProperty("x-dropped");
    expect(init.collector.placementEventId).toBe("placement-event-1");
  });

  it("falls back to the URL for the surface and host, and fills what the payload leaves out", () => {
    const init = initOf(
      {
        collector: { url: COLLECTOR.url, identity: { userId: { type: "aliasId", aliasId: "a1" } } },
      },
      "?client_surface=web-sdk&host_origin=https%3A%2F%2Fapp.example.com",
    );

    expect(init).toMatchObject({
      clientSurface: "web-sdk",
      hostOrigin: "https://app.example.com",
      managedPayments: false,
      paywallManagedPaymentsOverride: null,
    });
    expect(init).not.toHaveProperty("sdkVersion");
    expect(init.collector.placementEventId).toEqual(expect.any(String));
    expect(init.collector.headers).toEqual({});
    expect(init.collector.productSlice).toEqual({});
  });

  it("omits the surface metadata nobody supplied", () => {
    const init = initOf({ collector: COLLECTOR }, "");

    expect(init).not.toHaveProperty("clientSurface");
    expect(init).not.toHaveProperty("hostOrigin");
  });

  it("is null outside the Web SDK or without a collector it can report to", () => {
    expect(webSdkEventsInit("", "")).toBeNull();
    expect(webSdkEventsInit("#init=not-json", "")).toBeNull();
    expect(webSdkEventsInit(hashOf([1]), "")).toBeNull();
    expect(webSdkEventsInit(hashOf({ apiBase: "x" }), "")).toBeNull();
    expect(webSdkEventsInit(hashOf({ collector: "nope" }), "")).toBeNull();
    expect(webSdkEventsInit(hashOf({ collector: { ...COLLECTOR, url: "" } }), "")).toBeNull();
    expect(
      webSdkEventsInit(hashOf({ collector: { ...COLLECTOR, identity: { userId: "a1" } } }), ""),
    ).toBeNull();
    expect(
      webSdkEventsInit(
        hashOf({ collector: { ...COLLECTOR, identity: { userId: { type: "appUserId" } } } }),
        "",
      ),
    ).toBeNull();
  });

  it("reads the page's own location by default", () => {
    window.location.hash = hashOf(PAYLOAD);

    expect(webSdkEventsInit()?.collector.url).toBe(COLLECTOR.url);
  });
});

const events = (init: WebSdkEventsInit = initOf()) => new WebSdkEvents(init);

describe("WebSdkEvents", () => {
  it("reports the open batch paywall.js sends, once, as the identified user", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("navigator", { connection: { type: "wifi" } });
    const tracker = events();

    tracker.observe({ event_name: "ping" } as TOutgoingMessage);
    tracker.observe({ event_name: "ping" } as TOutgoingMessage);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe(COLLECTOR.url);
    expect(request).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
    expect(request.headers).toEqual({
      "x-public-api-key": "pk_web",
      "x-device-id": "$SuperwallDevice:d1",
      "x-platform": "web",
      "x-app-user-id": "user_1",
      "x-alias-id": "user_1",
      "x-device-interface-style": "dark",
      "x-radio-type": "wifi",
      "x-low-power-mode": "false",
      "content-type": "application/json",
    });
    expect(names()).toEqual([
      "web_checkout",
      "trigger_fire",
      "paywall_open",
      "user_attributes",
      "device_attributes",
    ]);
    const [placement, triggerFire, paywallOpen, attributes, device] = published();
    expect(placement).toMatchObject({
      event_id: "placement-event-1",
      parameters: { source: "result" },
    });
    expect(triggerFire!.parameters).toMatchObject({
      $experiment_id: "e1",
      $result: "present",
      $is_standard_event: true,
      $paywall_identifier: "paywall-simple-v2",
      $trigger_name: "web_checkout",
    });
    expect(paywallOpen!.parameters).toMatchObject({
      $paywall_id: "271256",
      $presented_by_event_name: "web_checkout",
      $client_surface: "web-sdk",
      $host_origin: "http://localhost:5175",
      $sdk_version: "0.2.9",
      $presentation_id: expect.any(String),
    });
    expect(attributes!.parameters).toMatchObject({ email: "ada@example.com" });
    expect(device!.parameters).toMatchObject({
      $appInstallDate: "2026-01-01T00:00:00.000Z",
      $interfaceStyle: "dark",
      $radioType: "wifi",
      $isLowPowerModeEnabled: false,
      $localDateTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
    });
    expect(new Set(published().map((event) => event.parameters.$presentation_id)).size).toBe(1);
  });

  it("reports an anonymous user by alias, and a light, unknown-network device", async () => {
    vi.stubGlobal("matchMedia", undefined);
    vi.stubGlobal("navigator", {});
    const init = initOf();
    const tracker = events({
      ...init,
      collector: {
        ...init.collector,
        identity: { userId: { type: "aliasId", aliasId: "$SuperwallAlias:a1" } },
        presentmentSlice: {},
        placementParamsSlice: {},
      },
    });

    tracker.observe({ event_name: "ping" } as TOutgoingMessage);
    await flush();

    const [, request] = fetchMock.mock.calls[0]!;
    expect(request.headers).toMatchObject({
      "x-app-user-id": "$SuperwallAlias:a1",
      "x-device-interface-style": "light",
      "x-radio-type": "unknown",
    });
    expect(request.headers).not.toHaveProperty("x-alias-id");
    expect(published()[0]).toMatchObject({ event_name: "", parameters: {} });
  });

  it("calls the network unknown when the browser will not say", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("navigator", {
      get connection() {
        throw new Error("blocked");
      },
    });

    events().observe({ event_name: "ping" } as TOutgoingMessage);
    await flush();

    expect(fetchMock.mock.calls[0]![1].headers["x-radio-type"]).toBe("unknown");
  });

  it("reports a close the paywall asks for, and merged attribute updates", async () => {
    const tracker = events();

    tracker.observe({ event_name: "close" });
    tracker.observe({
      event_name: "user_attribute_updated",
      attributes: [{ key: "plan", value: "annual" }],
    });
    await flush();

    expect(names()).toEqual(["paywall_close", "user_attributes"]);
    expect(published()[0]!.parameters).toMatchObject({
      $paywall_id: "271256",
      $experiment_id: "e1",
    });
    expect(published()[1]!.parameters).toMatchObject({ email: "ada@example.com", plan: "annual" });
  });

  it("reports page views with the previous page only when there was one", async () => {
    const tracker = events();

    tracker.observe({
      event_name: "page_view",
      type: "entry",
      page_node_id: "p1",
      flow_position: 0,
      page_name: "Plans",
      navigation_node_id: "n1",
    });
    tracker.observe({
      event_name: "page_view",
      type: "forward",
      page_node_id: "p2",
      flow_position: 1,
      page_name: "Pay",
      navigation_node_id: "n1",
      previous_page_node_id: "p1",
      previous_flow_position: 0,
      time_on_previous_page_ms: 1200,
    });
    await flush();

    const [entry, forward] = published();
    expect(entry).toMatchObject({
      event_name: "paywall_page_view",
      parameters: { $page_node_id: "p1", $navigation_type: "entry", $flow_position: 0 },
    });
    expect(entry!.parameters).not.toHaveProperty("$previous_page_node_id");
    expect(forward!.parameters).toMatchObject({
      $previous_page_node_id: "p1",
      $previous_flow_position: 0,
      $time_on_previous_page_ms: 1200,
    });
  });

  it("reports each Stripe checkout step, and a transaction start only for a prefetched session", async () => {
    const tracker = events();
    const step = (event_name: string, checkout_context_id: string, product_identifier = "annual") =>
      tracker.observe({ event_name, checkout_context_id, product_identifier } as TOutgoingMessage);

    step("stripe_checkout_prefetch", "ctx_1");
    step("stripe_checkout_start", "ctx_1");
    step("stripe_checkout_start", "ctx_2");
    step("stripe_checkout_submit", "ctx_1");
    step("stripe_checkout_fail", "ctx_1");
    step("stripe_checkout_abandon", "ctx_1");
    step("stripe_checkout_complete", "ctx_1");
    step("stripe_checkout_prefetch", "ctx_3", "stripe|monthly");
    step("stripe_checkout_start", "ctx_3", "stripe|monthly");
    await flush();

    expect(names()).toEqual([
      "stripeCheckout_prefetch",
      "stripeCheckout_start",
      "transaction_start",
      "stripeCheckout_start",
      "stripeCheckout_submit",
      "stripeCheckout_fail",
      "stripeCheckout_abandon",
      "transaction_abandon",
      "stripeCheckout_complete",
      "stripeCheckout_prefetch",
      "stripeCheckout_start",
      "transaction_start",
    ]);
    const all = published();
    expect(all[1]!.parameters).toMatchObject({
      $store: "STRIPE",
      $product_identifier: "annual",
      $checkout_context_id: "ctx_1",
    });
    expect(all[2]!.parameters).toMatchObject({
      $product_id: "stripe|annual",
      $product_identifier: "stripe|annual",
      $product_period: "year",
      $install_date: "2026-01-01T00:00:00.000Z",
      $placement_params: { source: "result" },
      $managed_payments: true,
      $paywall_managed_payments_override: "USE_MANAGED_PAYMENTS",
      $country_code: null,
    });
    expect(all[7]!.parameters).toMatchObject({ $product_id: "annual", $store: "STRIPE" });
    expect(all[7]!.parameters).not.toHaveProperty("$managed_payments");
    expect(all[11]!.parameters).toMatchObject({ $product_id: "stripe|monthly" });
  });

  it("dates a transaction now when the device has no install date, with managed payments off", async () => {
    const init = initOf();
    const tracker = events({
      collector: { ...init.collector, deviceAttributes: {} },
    });

    tracker.observe({
      event_name: "stripe_checkout_prefetch",
      checkout_context_id: "ctx_1",
      product_identifier: "annual",
    });
    tracker.observe({
      event_name: "stripe_checkout_start",
      checkout_context_id: "ctx_1",
      product_identifier: "annual",
    });
    await flush();

    const start = published().find((event) => event.event_name === "transaction_start")!;
    expect(start.parameters).toMatchObject({
      $install_date: expect.any(String),
      $managed_payments: false,
      $paywall_managed_payments_override: null,
      $client_surface: "web-direct",
    });
    expect(start.parameters).not.toHaveProperty("$host_origin");
    expect(start.parameters).not.toHaveProperty("$sdk_version");
  });

  it("ignores messages paywall.js does not report", async () => {
    events().observe({ event_name: "restore" });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays quiet when the host turned event tracking off", async () => {
    (window as Window & { __SW_EVENTS_DISABLED__?: boolean }).__SW_EVENTS_DISABLED__ = true;

    events().observe({ event_name: "close" });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a collector it cannot reach rather than failing the paywall", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("offline"));

    events().observe({ event_name: "close" });
    await flush();

    expect(error).toHaveBeenCalled();
  });

  it("builds from the page's location, and only inside the Web SDK", () => {
    expect(WebSdkEvents.fromLocation()).toBeNull();

    window.location.hash = hashOf(PAYLOAD);
    expect(WebSdkEvents.fromLocation()).toBeInstanceOf(WebSdkEvents);

    vi.stubGlobal("window", undefined);
    expect(WebSdkEvents.fromLocation()).toBeNull();
  });
});

describe("Web SDK transport events", () => {
  it("reports each outgoing message before handing it to the host", async () => {
    const host = { postMessage: vi.fn() };
    const tracker = new WebSdkEvents(initOf());
    const observe = vi.spyOn(tracker, "observe");
    const transport = new WebSdkTransport({
      hostWindow: host as unknown as Window,
      hostOrigin: "*",
      events: tracker,
    });

    transport.postMessage({ event_name: "close" });

    expect(observe).toHaveBeenCalledWith({ event_name: "close" });
    expect(observe.mock.invocationCallOrder[0]).toBeLessThan(
      host.postMessage.mock.invocationCallOrder[0]!,
    );
  });

  it("is wired up by the transport factory from the init payload", () => {
    window.location.hash = hashOf(PAYLOAD);
    const transport = buildTransport(TransportKind.WebSdk);

    transport.postMessage({ event_name: "close" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
