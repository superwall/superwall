import { afterEach, describe, expect, it, vi } from "vitest";
import type { TIncomingMessage, TOutgoingMessage } from "@superwall/protocol";
import pingReply from "../../protocol/test/fixtures/host/ping-reply.json";
import sdkLifecycle from "../../protocol/test/fixtures/host/sdk-lifecycle.json";
import {
  createHostState,
  createPaywallHost,
  recordingDelegate,
  type DelegateAnswers,
  type PaywallHost,
} from "../src";
import { FIXTURE_NOW, fixtureState } from "./messages.test";

const DAY_MS = 24 * 60 * 60 * 1000;

const setup = (answers: DelegateAnswers = {}, now = FIXTURE_NOW) => {
  const sent: TIncomingMessage[] = [];
  const delegate = recordingDelegate(answers);
  const host = createPaywallHost({
    state: fixtureState(),
    delegate,
    send: (events) => {
      sent.push(...events);
    },
    now: () => now,
  });
  return { host, delegate, sent };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const purchase = (host: PaywallHost, product = "primary", productId = "com.app.annual") =>
  host.receive([{ event_name: "purchase", product, product_identifier: productId }]);

const withoutPaywallIds = (events: Array<Record<string, unknown>>) =>
  events.map(({ paywall_id: _id, paywall_identifier: _identifier, ...rest }) => rest);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ping", () => {
  it("answers every ping with the fixture burst", () => {
    const { host, sent } = setup();
    host.receive([{ event_name: "ping", substitutions: [], page_styles: [] }]);
    expect(sent).toEqual(pingReply.events);
    host.receive([{ event_name: "ping", substitutions: [], page_styles: [] }]);
    expect(sent).toHaveLength(10);
  });

  it("forwards every message to the delegate before acting", () => {
    const { host, delegate } = setup();
    const page: TOutgoingMessage = {
      event_name: "page_view",
      type: "entry",
      page_node_id: "intro",
      flow_position: 0,
      page_name: "intro",
      navigation_node_id: "root",
    };
    host.receive([page]);
    expect(delegate.events).toEqual([page]);
  });
});

describe("purchase", () => {
  it("completes with a trial the way the iOS SDK does", async () => {
    const { host, sent } = setup({ purchase: "completed" });
    purchase(host);
    await flush();
    const expected = sdkLifecycle.sequences.purchase_completed_with_trial;
    expect(sent.map((event) => event.event_name)).toEqual(expected.map((e) => e.event_name));
    expect(sent[2]).toEqual({
      event_name: "freeTrial_start",
      product_identifier: "com.app.annual",
      trial_end_date: FIXTURE_NOW + 7 * DAY_MS,
    });
    expect(withoutPaywallIds(expected)[1]).toEqual({
      event_name: "transaction_complete",
      product_identifier: "com.app.annual",
    });
    expect(sent[1]).toMatchObject({
      event_name: "transaction_complete",
      product_identifier: "com.app.annual",
      product: "primary",
    });
  });

  it("sends no freeTrial_start when the host says the user is ineligible", async () => {
    const { host, sent } = setup({ purchase: "completed" });
    host.update({ introductoryOfferEligible: false });
    sent.length = 0;
    purchase(host);
    await flush();
    expect(sent.map((event) => event.event_name)).toEqual([
      "transaction_start",
      "transaction_complete",
    ]);
  });

  it("sends no freeTrial_start for a product without trial days", async () => {
    const { host, sent } = setup({ purchase: "completed" });
    host.update({
      products: [{ reference: "monthly", productId: "com.app.monthly", variables: {} }],
    });
    sent.length = 0;
    purchase(host, "monthly", "com.app.monthly");
    await flush();
    expect(sent.map((event) => event.event_name)).toEqual([
      "transaction_start",
      "transaction_complete",
    ]);
  });

  it("abandons and fails on request", async () => {
    const abandoned = setup({ purchase: "abandoned" });
    purchase(abandoned.host);
    await flush();
    expect(abandoned.sent.map((event) => event.event_name)).toEqual([
      "transaction_start",
      "transaction_abandon",
    ]);

    const failed = setup({ purchase: () => Promise.resolve("failed") });
    purchase(failed.host);
    await flush();
    expect(failed.sent.map((event) => event.event_name)).toEqual([
      "transaction_start",
      "transaction_fail",
    ]);
  });

  it("treats a throwing delegate as a failure and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, sent } = setup({
      purchase: () => {
        throw new Error("boom");
      },
    });
    purchase(host);
    await flush();
    expect(sent.at(-1)?.event_name).toBe("transaction_fail");
    expect(error).toHaveBeenCalledOnce();
  });

  it("resolves an unknown reference by store id, then falls back to the message", async () => {
    const { host, sent, delegate } = setup();
    let seen: string[] = [];
    delegate.purchase = (product) => {
      seen.push(product.reference);
      return "completed";
    };
    purchase(host, "unknown", "com.app.annual");
    await flush();
    expect(seen).toEqual(["primary"]);
    seen = [];
    purchase(host, "ghost", "nowhere");
    await flush();
    expect(seen).toEqual(["ghost"]);
    expect(sent.at(-1)).toMatchObject({ product: "ghost", product_identifier: "nowhere" });
  });
});

describe("restore", () => {
  it("restores through the iOS restore lifecycle", async () => {
    const { host, sent } = setup({ restore: "restored" });
    host.receive([{ event_name: "restore" }]);
    await flush();
    expect(sent.map((event) => event.event_name)).toEqual(
      sdkLifecycle.sequences.restore_completed.map((e) => e.event_name),
    );
  });

  it("fails through restore_fail", async () => {
    const { host, sent } = setup({ restore: "failed" });
    host.receive([{ event_name: "restore" }]);
    await flush();
    expect(sent.map((event) => event.event_name)).toEqual(["restore_start", "restore_fail"]);
  });

  it("fails when the delegate throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, sent } = setup({
      restore: () => Promise.reject(new Error("nope")),
    });
    host.receive([{ event_name: "restore" }]);
    await flush();
    expect(sent.map((event) => event.event_name)).toEqual(["restore_start", "restore_fail"]);
  });
});

describe("navigation and actions", () => {
  it("closes through the delegate and reports paywall_close", () => {
    const { host, sent, delegate } = setup();
    host.receive([{ event_name: "close" }]);
    expect(delegate.calls).toEqual([{ kind: "close" }]);
    expect(sent).toEqual([
      { event_name: "paywall_close", paywall_id: "123", paywall_identifier: "my_paywall" },
    ]);
  });

  it("routes every url kind", () => {
    const { host, delegate } = setup();
    host.receive([
      { event_name: "open_url", url: "https://a" },
      { event_name: "open_url", url: "https://b", browser_type: "payment_sheet" },
      { event_name: "open_url_external", url: "https://c" },
      { event_name: "open_deep_link", link: "app://d" },
    ]);
    expect(delegate.calls).toEqual([
      { kind: "openUrl", url: "https://a", urlKind: "in_app" },
      { kind: "openUrl", url: "https://b", urlKind: "payment_sheet" },
      { kind: "openUrl", url: "https://c", urlKind: "external" },
      { kind: "openUrl", url: "app://d", urlKind: "deep_link" },
    ]);
  });

  it("passes custom actions and placements through", () => {
    const { host, delegate } = setup();
    host.receive([
      { event_name: "custom", data: "hello" },
      { event_name: "custom_placement", name: "upsell", params: { plan: "pro" } },
    ]);
    expect(delegate.calls).toEqual([
      { kind: "custom", data: "hello" },
      { kind: "customPlacement", name: "upsell", params: { plan: "pro" } },
    ]);
  });

  it("merges user attributes into the next template_variables without replying", () => {
    const { host, sent } = setup();
    host.receive([
      { event_name: "user_attribute_updated", attributes: [{ key: "email", value: "a@b.co" }] },
    ]);
    expect(sent).toEqual([]);
    expect(host.state.user.email).toBe("a@b.co");
    host.update({ device: { interfaceStyle: "Light" } });
    const variables = sent[0];
    if (variables?.event_name !== "template_variables") throw new Error("expected variables");
    expect(variables.variables.user).toMatchObject({ email: "a@b.co", firstName: "John" });
  });
});

describe("permissions and callbacks", () => {
  it("answers a permission request with the delegate's status", async () => {
    const { host, sent } = setup({ permission: "denied" });
    host.receive([
      { event_name: "request_permission", permission_type: "notification", request_id: "r1" },
    ]);
    await flush();
    expect(sent).toEqual([
      {
        event_name: "permission_result",
        permission_type: "notification",
        request_id: "r1",
        status: "denied",
      },
    ]);
  });

  it("denies when the permission delegate throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, sent } = setup({
      permission: () => {
        throw new Error("no");
      },
    });
    host.receive([
      { event_name: "request_permission", permission_type: "camera", request_id: "r2" },
    ]);
    await flush();
    expect(sent[0]).toMatchObject({ status: "denied", request_id: "r2" });
  });

  it("answers a callback with data and echoes the raw name", async () => {
    const { host, sent } = setup({
      callback: (name, variables) => ({ status: "success", data: { name, ...variables } }),
    });
    host.receive([
      {
        event_name: "request_callback",
        request_id: "syncUser-blocking-8c3a7b0e",
        name: "sync user",
        behavior: "blocking",
        variables: { plan: "pro" },
      },
    ]);
    await flush();
    expect(sent).toEqual([
      {
        event_name: "callback_result",
        request_id: "syncUser-blocking-8c3a7b0e",
        name: "sync user",
        status: "success",
        data: { name: "sync user", plan: "pro" },
      },
    ]);
  });

  it("answers a failing callback without data, like an unregistered handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, sent } = setup({
      callback: () => Promise.reject(new Error("unregistered")),
    });
    host.receive([
      {
        event_name: "request_callback",
        request_id: "syncUser-blocking-8c3a7b0e",
        name: "sync user",
        behavior: "non-blocking",
      },
    ]);
    await flush();
    expect(sent).toEqual([withoutPaywallIds(sdkLifecycle.sequences.callback_unregistered)[0]]);
  });
});

describe("update", () => {
  it("sends nothing when nothing changed", () => {
    const { host, sent } = setup();
    host.update({ device: { platform: "iOS" } });
    expect(sent).toEqual([]);
  });

  it("re-sends only template_variables for a device edit", () => {
    const { host, sent } = setup();
    host.update({ device: { interfaceStyle: "Light" } });
    expect(sent.map((event) => event.event_name)).toEqual(["template_variables"]);
    expect(host.state.device.interfaceStyle).toBe("Light");
    expect(host.state.device.platform).toBe("iOS");
  });

  it("re-sends only the prefix for a trial toggle", () => {
    const { host, sent } = setup();
    host.update({ introductoryOfferEligible: false });
    expect(sent).toEqual([{ event_name: "template_substitutions_prefix", prefix: "default" }]);
    sent.length = 0;
    host.update({ introductoryOfferEligible: undefined });
    expect(sent).toEqual([{ event_name: "template_substitutions_prefix", prefix: "freeTrial" }]);
  });

  it("re-sends variables, products and the prefix when the catalogue changes", () => {
    const { host, sent } = setup();
    host.update({
      products: [{ reference: "primary", productId: "com.app.monthly", variables: {} }],
    });
    expect(sent.map((event) => event.event_name)).toEqual([
      "template_variables",
      "products",
      "template_substitutions_prefix",
    ]);
  });

  it("re-sends the experiment when it changes", () => {
    const { host, sent } = setup();
    host.update({ experiment: { experimentId: "1", variantId: "2", campaignId: "3" } });
    expect(sent).toEqual([
      { event_name: "experiment", experimentId: "1", variantId: "2", campaignId: "3" },
    ]);
  });

  it("drops undefined values instead of sending them", () => {
    const { host } = setup();
    host.update({ user: { email: undefined } });
    expect("email" in host.state.user).toBe(false);
  });
});

describe("resolving which product a paywall meant", () => {
  it("matches on the store identifier when the reference is unknown", async () => {
    const sent: unknown[] = [];
    const host = createPaywallHost({
      state: createHostState({
        products: [{ reference: "annual", productId: "com.app.annual", variables: {} }],
      }),
      delegate: recordingDelegate({ purchase: "completed" }),
      send: (messages) => sent.push(...messages),
    });

    await host.receive([
      { event_name: "purchase", product: "unknown", product_identifier: "com.app.annual" },
    ]);

    const complete = sent.find(
      (message) => (message as { event_name?: string }).event_name === "transaction_complete",
    );
    expect(complete).toMatchObject({ product_identifier: "com.app.annual" });
  });

  it("invents a product rather than dropping a purchase it cannot place", async () => {
    const sent: unknown[] = [];
    const host = createPaywallHost({
      state: createHostState(),
      delegate: recordingDelegate({ purchase: "completed" }),
      send: (messages) => sent.push(...messages),
    });

    await host.receive([{ event_name: "purchase", product: "primary" }]);

    expect(
      sent.some(
        (message) => (message as { event_name?: string }).event_name === "transaction_complete",
      ),
    ).toBe(true);
  });
});
