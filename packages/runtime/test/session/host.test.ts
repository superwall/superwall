import { describe, expect, it, vi } from "vitest";
import {
  createHostTransport,
  recordingDelegate,
  type DelegateAnswers,
  type HostStatePatch,
} from "@superwall/host";
import { IncomingMessageSchema } from "@superwall/protocol";
import pingReply from "../../../protocol/test/fixtures/host/ping-reply.json";
import type { SuperwallConfig } from "../../src/config";
import { createSuperwallSession } from "../../src/session";
import { TestTransport, flushMicrotasks } from "../support/testTransport";

const config: SuperwallConfig = {
  products: { primary: "pro_3999_year", secondary: "pro_999_month" },
  notifications: { trialReminder: { title: "Trial ending soon", body: "Keep Pro." } },
};

const priced = [
  {
    reference: "primary",
    productId: "pro_3999_year",
    variables: { price: "$39.99", period: "year", trialPeriodDays: 7 },
  },
  {
    reference: "secondary",
    productId: "pro_999_month",
    variables: { price: "$9.99", period: "month" },
  },
];

const hosted = (
  answers: DelegateAnswers = {},
  state: HostStatePatch = {},
  options: { latencyMs?: number } = {},
) => {
  const delegate = recordingDelegate(answers);
  const { transport, host } = createHostTransport({
    state: { paywallId: "123", paywallIdentifier: "my_paywall", products: priced, ...state },
    delegate,
    ...options,
  });
  const session = createSuperwallSession({ config, transport });
  const received: string[] = [];
  session.on("message", (message) => received.push(message.event_name));
  session.start({ sendPing: true });
  return { session, delegate, host, received };
};

describe("a session hosted in-process", () => {
  it("is opened by the host's ping reply, in the web host's order", async () => {
    const { session, received } = hosted();
    await flushMicrotasks();

    const snapshot = session.getSnapshot();
    expect(snapshot.paywall).toEqual({ id: "123", identifier: "my_paywall" });
    expect(snapshot.products).toHaveLength(2);
    expect(snapshot.productsByReference.primary).toMatchObject({
      source: "sdk",
      productId: "pro_3999_year",
      variables: { price: "$39.99", period: "year", trialPeriodDays: 7 },
    });
    expect(snapshot.introductoryOffer.eligible).toBe(true);
    expect(received).toEqual(pingReply.events.map((event) => event.event_name));
  });

  it("converges on the same snapshot from the iOS order as from the web order", () => {
    const [variables, experiment, products, prefix, open] = pingReply.events;
    const replay = (order: (typeof pingReply.events)[number][]) => {
      const transport = new TestTransport();
      const session = createSuperwallSession({ config, transport });
      session.start();
      for (const event of order) transport.accept(IncomingMessageSchema.parse(event));
      return session.getSnapshot();
    };
    if (!variables || !experiment || !products || !prefix || !open) {
      throw new Error("fixture order changed");
    }

    const web = replay([variables, experiment, products, prefix, open]);
    const ios = replay([products, variables, prefix, experiment, open]);

    expect(ios.products).toEqual(web.products);
    expect(ios.introductoryOffer).toEqual(web.introductoryOffer);
    expect(ios.paywall).toEqual(web.paywall);
    expect(ios.experiment).toEqual(web.experiment);
    expect(web.productsByReference.primary).toMatchObject({
      productId: "com.app.annual",
      variables: { price: "$89.99" },
    });
  });

  it("completes a purchase and schedules the configured trial reminder", async () => {
    const { session, delegate } = hosted({ purchase: "completed" });
    await flushMicrotasks();

    await expect(session.purchase("primary")).resolves.toMatchObject({ status: "completed" });
    await flushMicrotasks();

    expect(delegate.events).toContainEqual(
      expect.objectContaining({ event_name: "schedule_notification", title: "Trial ending soon" }),
    );
  });

  it("resolves abandoned and failed purchases the way the SDK reports them", async () => {
    const abandoned = hosted({ purchase: "abandoned" });
    await flushMicrotasks();
    await expect(abandoned.session.purchase("primary")).resolves.toMatchObject({
      status: "abandoned",
    });

    const failed = hosted({ purchase: "failed" });
    await flushMicrotasks();
    await expect(failed.session.purchase("primary")).resolves.toMatchObject({
      status: "failed",
      reason: "sdk",
    });
    expect(failed.session.getSnapshot().pendingPurchase).toBeUndefined();
    expect(failed.session.getSnapshot().lastPurchaseFailure?.reason).toBe("sdk");
  });

  it("supports per-product purchase outcomes", async () => {
    const { session } = hosted({
      purchase: (product) => (product.reference === "primary" ? "completed" : "abandoned"),
    });
    await flushMicrotasks();

    await expect(session.purchase("primary")).resolves.toMatchObject({ status: "completed" });
    await expect(session.purchase("secondary")).resolves.toMatchObject({ status: "abandoned" });
  });

  it("respects forced ineligibility from the host", async () => {
    const { session } = hosted({}, { introductoryOfferEligible: false });
    await flushMicrotasks();
    expect(session.getSnapshot().introductoryOffer.eligible).toBe(false);
  });

  it("records the restore lifecycle without inventing a transaction", async () => {
    const restored = hosted({ restore: "restored" });
    await flushMicrotasks();
    restored.session.restore();
    await flushMicrotasks();
    expect(restored.session.getSnapshot().restore).toEqual({ status: "completed" });
    expect(restored.session.getSnapshot().lastTransaction).toBeUndefined();

    const failed = hosted({ restore: "failed" });
    await flushMicrotasks();
    failed.session.restore();
    await flushMicrotasks();
    expect(failed.session.getSnapshot().restore).toEqual({ status: "failed" });
  });

  it("resolves the restore it started, with the outcome the host chose", async () => {
    const restored = hosted({ restore: "restored" });
    await flushMicrotasks();
    await expect(restored.session.restore()).resolves.toEqual({ status: "restored" });

    const failed = hosted({ restore: "failed" });
    await flushMicrotasks();
    await expect(failed.session.restore()).resolves.toEqual({ status: "failed" });
  });

  it("answers a second restore with the first one's promise", async () => {
    // Restore takes no argument and the SDK runs one at a time, so a second tap
    // joins the restore already in flight rather than starting a rival one.
    const { session } = hosted({ restore: "restored" });
    await flushMicrotasks();

    const first = session.restore();
    const second = session.restore();

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ status: "restored" });
  });

  it("resolves permission requests", async () => {
    const { session } = hosted({ permission: "denied" });
    await flushMicrotasks();

    await expect(session.requestPermission("notification")).resolves.toBe("denied");
    expect(session.getSnapshot().permissionStatuses.notification).toBe("denied");
  });

  it("resolves callbacks with the host's answer and paywall.js's request id format", async () => {
    const { session, delegate } = hosted({
      callback: async (name, variables) => ({
        status: "success",
        data: { name, got: variables.tier },
      }),
    });
    await flushMicrotasks();

    await expect(
      session.requestCallback("sync entitlements", { variables: { tier: "gold" } }),
    ).resolves.toMatchObject({ data: { name: "sync entitlements", got: "gold" } });
    const request = delegate.events.find((event) => event.event_name === "request_callback");
    if (request?.event_name !== "request_callback") throw new Error("no callback request");
    expect(request.name).toBe("sync entitlements");
    expect(request.request_id).toMatch(/^syncEntitlements-blocking-/);
  });

  it("delivers user, params, experiment, and device variables", async () => {
    const { session } = hosted(
      {},
      {
        device: { deviceLocale: "de_DE" },
        user: { firstName: "Ada" },
        params: { source: "onboarding" },
        experiment: { experimentId: "e1", variantId: "v1", campaignId: "c1" },
      },
    );
    await flushMicrotasks();

    const snapshot = session.getSnapshot();
    expect(snapshot.device.deviceLocale).toBe("de_DE");
    expect(snapshot.user).toEqual({ firstName: "Ada" });
    expect(snapshot.params).toEqual({ source: "onboarding" });
    expect(snapshot.experiment).toEqual({ experimentId: "e1", variantId: "v1", campaignId: "c1" });
  });

  it("records the host's event tracking behavior", async () => {
    const { session, host } = hosted();
    await flushMicrotasks();
    host.send([{ event_name: "event_tracking_behavior", behavior: "none" }]);
    await flushMicrotasks();
    expect(session.getSnapshot().eventTrackingBehavior).toBe("none");
  });

  it("delivers with latency when asked", async () => {
    vi.useFakeTimers();
    try {
      const { session } = hosted({}, {}, { latencyMs: 500 });
      await vi.advanceTimersByTimeAsync(499);
      expect(session.getSnapshot().paywall).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(session.getSnapshot().paywall).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("purchases the Play product on an Android device and the App Store one on iOS", async () => {
    const platformConfig: SuperwallConfig = {
      products: { annual: { ios: "pro_year", android: "pro_year_play" } },
    };
    for (const [platform, expected] of [
      ["Android", "pro_year_play"],
      ["iOS", "pro_year"],
    ] as const) {
      const { transport } = createHostTransport({
        state: { device: { platform } },
        delegate: recordingDelegate(),
      });
      const session = createSuperwallSession({ config: platformConfig, transport });
      session.start({ sendPing: true });
      await flushMicrotasks();

      void session.purchase("annual");
      expect(session.getSnapshot().pendingPurchase?.product.productId).toBe(expected);
    }
  });
});
