import { describe, expect, it, vi } from "vitest";
import { defineSuperwallConfig } from "../src/config";
import { createMockSuperwallTransport, mockOptionsFromConfig } from "../src/mock";
import { createSuperwallSession } from "../src/session";
import { flushMicrotasks } from "./testTransport";

const config = defineSuperwallConfig({
  products: {
    primary: "pro_3999_year",
    secondary: "pro_999_month",
  },
  notifications: {
    trialReminder: { title: "Trial ending soon", body: "Keep Pro." },
  },
});

/**
 * Product variables are never invented — a caller supplies what the store would
 * report, or the paywall sees nothing. These stand in for Superwall.
 */
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

const createMockedSession = (
  mockOptions: Parameters<typeof createMockSuperwallTransport>[0] = {},
) => {
  const transport = createMockSuperwallTransport(
    mockOptionsFromConfig(config, { products: priced, ...mockOptions }),
  );
  const session = createSuperwallSession({ config, transport });
  session.start({ sendPing: true });
  return { session, transport };
};

describe("MockSuperwallTransport", () => {
  it("answers ping with paywall, products, variables, and trial eligibility", async () => {
    const { session } = createMockedSession();
    await flushMicrotasks();

    const snapshot = session.getSnapshot();
    expect(snapshot.paywall).toMatchObject({ id: "mock-paywall" });
    expect(snapshot.products).toHaveLength(2);
    expect(snapshot.productsByReference.primary).toMatchObject({
      source: "sdk",
      productId: "pro_3999_year",
      variables: { price: "$39.99", period: "year", trialPeriodDays: 7 },
    });
    expect(snapshot.device).toMatchObject({ platform: "iOS", deviceLocale: "en_US" });
    // primary has trial variables → mock reports eligibility
    expect(snapshot.trial.eligible).toBe(true);
  });

  it("completes purchases and starts trials for trial products", async () => {
    const onOutgoing = vi.fn();
    const { session } = createMockedSession({ onOutgoing });
    await flushMicrotasks();

    const result = await session.purchase("primary");
    expect(result).toMatchObject({ status: "completed" });
    await flushMicrotasks();

    // freeTrial_start from the mock triggers the configured reminder
    expect(onOutgoing).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "schedule_notification",
        title: "Trial ending soon",
      }),
    );
  });

  it("supports abandoned purchase outcomes", async () => {
    const { session } = createMockedSession({ purchaseOutcome: "abandoned" });
    await flushMicrotasks();

    await expect(session.purchase("primary")).resolves.toMatchObject({ status: "abandoned" });
  });

  it("supports per-product purchase outcomes", async () => {
    const { session } = createMockedSession({
      purchaseOutcome: ({ reference }) => (reference === "primary" ? "completed" : "abandoned"),
    });
    await flushMicrotasks();

    await expect(session.purchase("primary")).resolves.toMatchObject({ status: "completed" });
    await expect(session.purchase("secondary")).resolves.toMatchObject({ status: "abandoned" });
  });

  it("respects forced trial ineligibility", async () => {
    const { session } = createMockedSession({ trialEligible: false });
    await flushMicrotasks();

    expect(session.getSnapshot().trial.eligible).toBe(false);
  });

  it("resolves permission requests", async () => {
    const { session } = createMockedSession({ permissions: { notification: "denied" } });
    await flushMicrotasks();

    await expect(session.requestPermission("notification")).resolves.toBe("denied");
    expect(session.getSnapshot().permissionStatuses.notification).toBe("denied");
  });

  it("resolves callbacks with configured results", async () => {
    const { session } = createMockedSession({
      callbacks: { syncEntitlements: { status: "success", data: { synced: true } } },
    });
    await flushMicrotasks();

    await expect(session.requestCallback("syncEntitlements")).resolves.toMatchObject({
      status: "success",
      data: { synced: true },
    });
  });

  it("delivers user, params, experiment, and custom device variables", async () => {
    const transport = createMockSuperwallTransport(
      mockOptionsFromConfig(config, {
        device: { deviceLocale: "de_DE" },
        user: { firstName: "Ada" },
        params: { source: "onboarding" },
        experiment: { experimentId: "e1", variantId: "v1", campaignId: "c1" },
      }),
    );
    const session = createSuperwallSession({ config, transport });
    session.start({ sendPing: true });
    await flushMicrotasks();

    const snapshot = session.getSnapshot();
    expect(snapshot.device.deviceLocale).toBe("de_DE");
    expect(snapshot.user).toEqual({ firstName: "Ada" });
    expect(snapshot.params).toEqual({ source: "onboarding" });
    expect(snapshot.experiment).toEqual({
      experimentId: "e1",
      variantId: "v1",
      campaignId: "c1",
    });
  });

  it("supports restoreOutcome none", async () => {
    const { session } = createMockedSession({ restoreOutcome: "none" });
    await flushMicrotasks();

    session.restore();
    await flushMicrotasks();
    expect(session.getSnapshot().lastTransaction).toBeUndefined();
  });

  it("supports async callback functions", async () => {
    const { session } = createMockedSession({
      callbacks: {
        fetchOffer: async (variables) => ({
          status: "success",
          data: { got: variables?.tier },
        }),
      },
    });
    await flushMicrotasks();

    await expect(
      session.requestCallback("fetchOffer", { variables: { tier: "gold" } }),
    ).resolves.toMatchObject({ data: { got: "gold" } });
  });

  it("delivers with simulated latency", async () => {
    vi.useFakeTimers();
    try {
      const transport = createMockSuperwallTransport(
        mockOptionsFromConfig(config, { latencyMs: 500 }),
      );
      const session = createSuperwallSession({ config, transport });
      session.start({ sendPing: true });

      await vi.advanceTimersByTimeAsync(499);
      expect(session.getSnapshot().paywall).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(session.getSnapshot().paywall).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces throwing purchase outcomes as console errors, not rejections", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { session } = createMockedSession({
        purchaseOutcome: () => {
          throw new Error("boom");
        },
      });
      await flushMicrotasks();

      void session.purchase("primary");
      await flushMicrotasks();

      expect(consoleError).toHaveBeenCalledWith(
        "[MockSuperwallTransport] Failed to handle outgoing message",
        expect.objectContaining({ event: "purchase" }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reports outgoing messages to the observer", async () => {
    const onOutgoing = vi.fn();
    const { session } = createMockedSession({ onOutgoing });
    await flushMicrotasks();

    session.close();
    expect(onOutgoing).toHaveBeenCalledWith(expect.objectContaining({ event_name: "ping" }));
    expect(onOutgoing).toHaveBeenCalledWith(expect.objectContaining({ event_name: "close" }));
  });
});

describe("mockOptionsFromConfig", () => {
  it("resolves per-platform product ids by the mocked device's platform", async () => {
    const mock = await import("../src/mock");
    const platformConfig = {
      products: { annual: { ios: "pro_year", android: "pro_year_play" }, monthly: "pro_month" },
    };
    const ids = (products: readonly unknown[] | undefined) =>
      (products ?? []).map((product) =>
        typeof product === "object" && product !== null && "productId" in product
          ? product.productId
          : product,
      );

    const android = mock.mockOptionsFromConfig(platformConfig, { device: { platform: "Android" } });
    expect(ids(android.products)).toEqual(["pro_year_play", "pro_month"]);

    const unknown = mock.mockProductsFromConfig(platformConfig);
    expect(unknown[0]?.productId).toBe("pro_year");
  });
});

describe("mock host product identity by device platform", () => {
  const platformConfig = defineSuperwallConfig({
    products: { annual: { ios: "pro_year", android: "pro_year_play" } },
  });

  it("an Android device in dev purchases the Play product, an iOS device the App Store one", async () => {
    for (const [platform, expected] of [
      ["Android", "pro_year_play"],
      ["iOS", "pro_year"],
    ] as const) {
      const transport = createMockSuperwallTransport(
        mockOptionsFromConfig(platformConfig, { device: { platform } }),
      );
      const session = createSuperwallSession({ config: platformConfig, transport });
      session.start({ sendPing: true });
      await flushMicrotasks();

      expect(session.getSnapshot().productsByReference.annual?.productId).toBe(expected);
      void session.purchase("annual");
      expect(session.getSnapshot().pendingPurchase?.product.productIdentifier).toBe(expected);
    }
  });
});
