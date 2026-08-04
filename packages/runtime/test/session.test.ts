import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSuperwallConfig } from "../src/config";
import { createSuperwallSession } from "../src/session";
import { TestTransport } from "./testTransport";

const createSession = (options: Parameters<typeof createSuperwallSession>[0] = {}) => {
  const transport = new TestTransport();
  const session = createSuperwallSession({ transport, ...options });
  session.start();
  return { session, transport };
};

describe("SuperwallSession products", () => {
  it("merges products and template variables from incoming messages", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "products",
      products: [{ product: "primary", productId: "pro_3999_year" }],
    });

    transport.accept({
      event_name: "template_variables",
      variables: {
        products: [{ primary: { price: "$39.99", period: "year" } }],
      },
    });

    const { products, productsByReference } = session.getSnapshot();
    expect(products).toHaveLength(1);
    expect(productsByReference.primary).toMatchObject({
      reference: "primary",
      productId: "pro_3999_year",
      source: "sdk",
      variables: { price: "$39.99", period: "year" },
    });
  });

  it("seeds product references from the config until the SDK delivers data", () => {
    const config = defineSuperwallConfig({
      products: {
        primary: "pro_3999_year",
        secondary: { productId: "pro_999_month" },
      },
    });

    const { session } = createSession({ config });

    expect(session.getSnapshot().productsByReference.primary).toMatchObject({
      source: "inline",
      productId: "pro_3999_year",
    });
    expect(session.getSnapshot().productsByReference.secondary).toMatchObject({
      productId: "pro_999_month",
    });
  });
});

describe("SuperwallSession variables", () => {
  it("exposes device, user, and params from template variables", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "template_variables",
      variables: {
        device: { platform: "iOS", locale: "en_US" },
        user: { firstName: "Ada" },
        params: { source: "onboarding" },
      },
    });

    const snapshot = session.getSnapshot();
    expect(snapshot.device).toMatchObject({ platform: "iOS", locale: "en_US" });
    expect(snapshot.user).toMatchObject({ firstName: "Ada" });
    expect(snapshot.params).toMatchObject({ source: "onboarding" });
  });

  it("tracks experiment assignment", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "experiment",
      experimentId: "exp_1",
      variantId: "var_2",
      campaignId: "cmp_3",
    });

    expect(session.getSnapshot().experiment).toEqual({
      experimentId: "exp_1",
      variantId: "var_2",
      campaignId: "cmp_3",
    });
  });
});

describe("SuperwallSession trial eligibility", () => {
  it("derives eligibility from the substitutions prefix", () => {
    const { session, transport } = createSession();
    expect(session.getSnapshot().trial.eligible).toBeUndefined();

    transport.accept({ event_name: "template_substitutions_prefix", prefix: "freeTrial" });
    expect(session.getSnapshot().trial.eligible).toBe(true);
    expect(session.getSnapshot().state).toMatchObject({
      products: { hasIntroductoryOffer: true },
    });

    transport.accept({ event_name: "template_substitutions_prefix", prefix: null });
    expect(session.getSnapshot().trial.eligible).toBe(false);
  });

  it("lets the config force eligibility", () => {
    const { session, transport } = createSession({
      config: defineSuperwallConfig({ introductoryOfferEligibility: "alwaysEligible" }),
    });

    expect(session.getSnapshot().trial.eligible).toBe(true);

    transport.accept({ event_name: "template_substitutions_prefix", prefix: null });
    expect(session.getSnapshot().trial.eligible).toBe(true);
  });
});

describe("SuperwallSession localization", () => {
  const config = defineSuperwallConfig({
    localization: {
      defaultLocale: "en",
      messages: {
        en: { paywall: { title: "Go Pro", ctaTrial: "Start {days}-day free trial" } },
        de: { paywall: { title: "Hol dir Pro" } },
      },
    },
  });

  it("translates with interpolation and falls back to the key", () => {
    const { session } = createSession({ config });

    expect(session.locale).toBe("en");
    expect(session.t("paywall.title")).toBe("Go Pro");
    expect(session.t("paywall.ctaTrial", { days: 7 })).toBe("Start 7-day free trial");
    expect(session.t("Literal copy stays as-is")).toBe("Literal copy stays as-is");
  });

  it("resolves the locale from device variables and supports overrides", () => {
    const { session, transport } = createSession({ config });

    transport.accept({
      event_name: "template_variables",
      variables: { device: { deviceLocale: "de_DE" } },
    });

    expect(session.locale).toBe("de");
    expect(session.t("paywall.title")).toBe("Hol dir Pro");
    // missing keys fall back to the default locale's catalog
    expect(session.t("paywall.ctaTrial", { days: 7 })).toBe("Start 7-day free trial");

    session.setLocale("en");
    expect(session.t("paywall.title")).toBe("Go Pro");
  });
});

describe("SuperwallSession product variable localization", () => {
  it("localizes period and periodly to the device locale automatically", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "template_variables",
      variables: {
        device: { deviceLocale: "es_ES" },
        products: [{ primary: { price: "$39.99", period: "year", periodly: "yearly" } }],
      },
    });

    expect(session.getSnapshot().productsByReference.primary?.variables).toMatchObject({
      price: "$39.99",
      period: "año",
      periodly: "anual",
    });
  });

  it("re-localizes when the locale changes", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "template_variables",
      variables: {
        products: [{ primary: { period: "month" } }],
      },
    });

    expect(session.getSnapshot().productsByReference.primary?.variables.period).toBe("month");

    session.setLocale("pt_BR");
    expect(session.getSnapshot().productsByReference.primary?.variables.period).toBe("mês");

    session.setLocale(undefined);
    expect(session.getSnapshot().productsByReference.primary?.variables.period).toBe("month");
  });
});

describe("SuperwallSession derived product variables", () => {
  it("derives trialPeriodEndDate from trialPeriodDays when the SDK omits it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    try {
      const { session, transport } = createSession();

      transport.accept({
        event_name: "template_variables",
        variables: { products: [{ primary: { trialPeriodDays: 7 } }] },
      });

      expect(
        session.getSnapshot().productsByReference.primary?.variables.trialPeriodEndDate,
      ).toMatch(/^\w+ 23, 2026$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never overwrites an SDK-provided trialPeriodEndDate", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "template_variables",
      variables: {
        products: [{ primary: { trialPeriodDays: 7, trialPeriodEndDate: "Aug 1, 2026" } }],
      },
    });

    expect(session.getSnapshot().productsByReference.primary?.variables.trialPeriodEndDate).toBe(
      "Aug 1, 2026",
    );
  });
});

describe("SuperwallSession trial reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-schedules the configured reminder on freeTrial_start, localized", () => {
    const { session, transport } = createSession({
      config: defineSuperwallConfig({
        notifications: {
          trialReminder: {
            title: "notifications.trialTitle",
            body: "Plain body",
            beforeTrialEndDays: 1,
          },
        },
        localization: {
          defaultLocale: "en",
          messages: { en: { notifications: { trialTitle: "Trial ending soon" } } },
        },
      }),
    });

    transport.accept({
      event_name: "paywall_open",
      paywall_id: "pw_1",
      paywall_identifier: "pw-identifier",
    });

    transport.accept({
      event_name: "freeTrial_start",
      product_identifier: "pro_3999_year",
      trial_end_date: "2026-07-23T00:00:00Z",
    });

    const scheduled = transport.outgoing.find(
      (message) => message.event_name === "schedule_notification",
    );
    expect(scheduled).toMatchObject({
      id: "pw-identifier_TRIAL_STARTED",
      type: "TRIAL_STARTED",
      title: "Trial ending soon",
      body: "Plain body",
      delay: 6 * 24 * 60 * 60 * 1000,
    });
    expect(session.getSnapshot().messages.length).toBeGreaterThan(0);
  });

  it("supports dynamic reminders computed from the trial context", () => {
    const { transport } = createSession({
      config: defineSuperwallConfig({
        products: { primary: "pro_3999_year" },
        notifications: {
          trialReminder: ({ trialEndDate, product, t }) => ({
            title: t("Almost over"),
            body: `Ends ${trialEndDate.toISOString().slice(0, 10)} for ${product?.productId}`,
            delayMs: trialEndDate.getTime() - Date.now() - 12 * 60 * 60 * 1000,
          }),
        },
      }),
    });

    transport.accept({
      event_name: "freeTrial_start",
      product_identifier: "pro_3999_year",
      trial_end_date: "2026-07-23T00:00:00Z",
    });

    expect(
      transport.outgoing.find((message) => message.event_name === "schedule_notification"),
    ).toMatchObject({
      title: "Almost over",
      body: "Ends 2026-07-23 for pro_3999_year",
      delay: 6.5 * 24 * 60 * 60 * 1000,
    });
  });

  it("skips scheduling when a dynamic reminder returns null", () => {
    const { transport } = createSession({
      config: defineSuperwallConfig({
        notifications: { trialReminder: () => null },
      }),
    });

    transport.accept({
      event_name: "freeTrial_start",
      trial_end_date: "2026-07-23T00:00:00Z",
    });

    expect(
      transport.outgoing.find((message) => message.event_name === "schedule_notification"),
    ).toBeUndefined();
  });

  it("does nothing without a configured reminder or trial end date", () => {
    const { transport } = createSession({
      config: defineSuperwallConfig({
        notifications: {
          trialReminder: { title: "T", body: "B" },
        },
      }),
    });

    transport.accept({ event_name: "freeTrial_start", product_identifier: "p" });

    expect(
      transport.outgoing.find((message) => message.event_name === "schedule_notification"),
    ).toBeUndefined();
  });
});

describe("SuperwallSession purchase", () => {
  it("resolves purchase with the completing transaction", async () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "products",
      products: [{ product: "primary", productId: "pro_3999_year" }],
    });

    const purchasePromise = session.purchase("primary");
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");
    expect(transport.outgoing.at(-1)).toMatchObject({
      event_name: "purchase",
      product: "primary",
      product_identifier: "pro_3999_year",
    });

    transport.accept({ event_name: "transaction_complete", product: "primary" });

    const result = await purchasePromise;
    expect(result.status).toBe("completed");
    expect(result.product.reference).toBe("primary");
    expect(session.getSnapshot().pendingPurchase).toBeUndefined();
    expect(session.getSnapshot().lastTransaction?.status).toBe("completed");
  });

  it("resolves purchase as abandoned", async () => {
    const { session, transport } = createSession();

    const purchasePromise = session.purchase("primary");
    transport.accept({ event_name: "transaction_abandon", product: "primary" });

    await expect(purchasePromise).resolves.toMatchObject({ status: "abandoned" });
  });

  describe("timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("fails the purchase after timeoutMs without a transaction", async () => {
      const { session } = createSession();

      const purchasePromise = session.purchase("primary", { timeoutMs: 5_000 });
      vi.advanceTimersByTime(5_000);

      await expect(purchasePromise).resolves.toMatchObject({
        status: "failed",
        reason: "timeout",
      });
      expect(session.getSnapshot().pendingPurchase).toBeUndefined();
      expect(session.getSnapshot().lastPurchaseFailure?.reason).toBe("timeout");
    });

    it("uses the config purchase timeout as the default", async () => {
      const { session } = createSession({
        config: defineSuperwallConfig({ purchaseTimeoutMs: 2_000 }),
      });

      const purchasePromise = session.purchase("primary");
      vi.advanceTimersByTime(2_000);

      await expect(purchasePromise).resolves.toMatchObject({ status: "failed" });
    });

    it("does not time out once the transaction resolves", async () => {
      const { session, transport } = createSession();

      const purchasePromise = session.purchase("primary", { timeoutMs: 5_000 });
      transport.accept({ event_name: "transaction_complete", product: "primary" });
      vi.advanceTimersByTime(10_000);

      await expect(purchasePromise).resolves.toMatchObject({ status: "completed" });
      expect(session.getSnapshot().lastPurchaseFailure).toBeUndefined();
    });
  });
});

describe("SuperwallSession purchase attribution", () => {
  it("does not resolve a pending purchase from an unrelated transaction", async () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "products",
      products: [
        { product: "primary", productId: "pro_year" },
        { product: "secondary", productId: "pro_month" },
      ],
    });

    const primaryPurchase = session.purchase("primary");
    let settled = false;
    void primaryPurchase.then(() => {
      settled = true;
    });

    // e.g. a restore completing another product while primary is pending
    transport.accept({ event_name: "transaction_complete", product: "secondary" });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");
    expect(session.getSnapshot().lastTransaction?.product.reference).toBe("secondary");

    transport.accept({ event_name: "transaction_complete", product: "primary" });
    await expect(primaryPurchase).resolves.toMatchObject({ status: "completed" });
  });

  it("attributes a bare transaction to the single pending purchase", async () => {
    const { session, transport } = createSession();

    const purchasePromise = session.purchase("primary");
    transport.accept({ event_name: "transaction_complete" });

    await expect(purchasePromise).resolves.toMatchObject({
      status: "completed",
      product: { reference: "primary" },
    });
  });

  it("supersedes a previous pending purchase for the same product", async () => {
    vi.useFakeTimers();
    try {
      const { session, transport } = createSession();

      const first = session.purchase("primary", { timeoutMs: 5_000 });
      vi.advanceTimersByTime(1_000);
      const second = session.purchase("primary");

      await expect(first).resolves.toMatchObject({ status: "failed", reason: "superseded" });

      // the first purchase's timer must not fire against the retry
      vi.advanceTimersByTime(10_000);
      expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");

      transport.accept({ event_name: "transaction_complete", product: "primary" });
      await expect(second).resolves.toMatchObject({ status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles in-flight purchases when the paywall (re)opens", async () => {
    const { session, transport } = createSession();

    const purchasePromise = session.purchase("primary");
    transport.accept({
      event_name: "paywall_open",
      paywall_id: "pw_1",
      paywall_identifier: "pw-identifier",
    });

    await expect(purchasePromise).resolves.toMatchObject({
      status: "failed",
      reason: "superseded",
    });
    expect(session.getSnapshot().pendingPurchase).toBeUndefined();
    expect(session.getSnapshot().lastPurchaseFailure).toBeUndefined();
  });
});

describe("SuperwallSession configure", () => {
  it("reseeds product slots from a late-arriving config", () => {
    const { session } = createSession();
    expect(session.getSnapshot().products).toHaveLength(0);

    session.configure(
      defineSuperwallConfig({
        products: { primary: "pro_3999_year" },
        introductoryOfferEligibility: "alwaysEligible",
      }),
    );

    expect(session.getSnapshot().productsByReference.primary).toMatchObject({
      productId: "pro_3999_year",
      source: "inline",
    });
    expect(session.getSnapshot().trial.eligible).toBe(true);
  });

  it("never overwrites SDK-delivered products", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "products",
      products: [{ product: "primary", productId: "sdk_product" }],
    });

    session.configure(defineSuperwallConfig({ products: { primary: "config_product" } }));

    expect(session.getSnapshot().productsByReference.primary?.productId).toBe("sdk_product");
  });
});

describe("SuperwallSession start", () => {
  it("pings when requested even if already listening", () => {
    const { session, transport } = createSession();

    session.start({ sendPing: true });
    expect(transport.outgoing.filter((message) => message.event_name === "ping")).toHaveLength(1);
  });
});

describe("SuperwallSession snapshot immutability", () => {
  it("gives messages a stable identity until a new message arrives", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "paywall_open",
      paywall_id: "pw",
      paywall_identifier: "pw-id",
    });

    const before = session.getSnapshot().messages;
    session.setLocale("de");
    expect(session.getSnapshot().messages).toBe(before);

    transport.accept({ event_name: "template_substitutions_prefix", prefix: null });
    const after = session.getSnapshot().messages;
    expect(after).not.toBe(before);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe("SuperwallSession events", () => {
  it("notifies typed event handlers and supports unsubscribe", () => {
    const { session, transport } = createSession();
    const onPaywallOpen = vi.fn();
    const onAnyMessage = vi.fn();

    const unsubscribe = session.on("paywall_open", onPaywallOpen);
    session.on("message", onAnyMessage);

    transport.accept({
      event_name: "paywall_open",
      paywall_id: "pw_1",
      paywall_identifier: "pw-identifier",
    });

    expect(onPaywallOpen).toHaveBeenCalledWith(expect.objectContaining({ paywall_id: "pw_1" }));
    expect(onAnyMessage).toHaveBeenCalledTimes(1);

    unsubscribe();
    transport.accept({
      event_name: "paywall_open",
      paywall_id: "pw_2",
      paywall_identifier: "pw-identifier",
    });

    expect(onPaywallOpen).toHaveBeenCalledTimes(1);
    expect(onAnyMessage).toHaveBeenCalledTimes(2);
  });
});
