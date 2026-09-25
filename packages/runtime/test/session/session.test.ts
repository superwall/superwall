import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuperwallConfig } from "../../src/config";
import { createSuperwallSession } from "../../src/session";
import { TestTransport } from "../support/testTransport";

const createSession = (config?: SuperwallConfig) => {
  const transport = new TestTransport();
  const session = createSuperwallSession({ transport, config });
  session.start();
  return { session, transport };
};

describe("products", () => {
  it("merges products and template variables from incoming messages", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "products",
      products: [{ product: "primary", productId: "pro_3999_year" }],
    });
    transport.accept({
      event_name: "template_variables",
      variables: { products: [{ primary: { price: "$39.99", period: "year" } }] },
    });

    expect(session.getSnapshot().products).toEqual([
      {
        reference: "primary",
        productId: "pro_3999_year",
        source: "sdk",
        variables: { price: "$39.99", period: "year" },
      },
    ]);
  });

  it("has no products until a host delivers them, and then carries exactly what it sent", () => {
    const { session, transport } = createSession({
      products: { primary: "pro_3999_year", secondary: { productId: "pro_999_month" } },
    });
    expect(session.getSnapshot().products).toEqual([]);

    transport.accept({
      event_name: "products",
      products: [
        { product: "primary", productId: "pro_3999_year" },
        { product: "secondary", productId: "pro_999_month" },
      ],
    });
    transport.accept({
      event_name: "template_variables",
      variables: {
        products: [{ primary: { price: "$39.99" } }, { secondary: { price: "$9.99" } }],
      },
    });

    const { productsByReference } = session.getSnapshot();
    expect(productsByReference.primary).toMatchObject({
      productId: "pro_3999_year",
      variables: { price: "$39.99" },
    });
    expect(productsByReference.secondary).toMatchObject({
      productId: "pro_999_month",
      variables: { price: "$9.99" },
    });
  });

  it("takes products the paywall supplied itself, without touching the host's variables", () => {
    const { session, transport } = createSession();
    transport.accept({
      event_name: "template_variables",
      variables: { device: { platform: "Web" } },
    });

    session.supplyProducts([
      { reference: "primary", productId: "live:price_1:no-trial", variables: { price: "$49.99" } },
    ]);

    expect(session.getSnapshot().device).toEqual({ platform: "Web" });
    expect(session.getSnapshot().productsByReference.primary).toMatchObject({
      productId: "live:price_1:no-trial",
      variables: { price: "$49.99" },
    });
  });

  it("refreshes what it supplied, but stops once the host sends its own", () => {
    const { session, transport } = createSession();
    const supply = (price: string) =>
      session.supplyProducts([
        { reference: "primary", productId: "live:price_1:no-trial", variables: { price } },
      ]);

    supply("$49.99");
    supply("$44.99");
    expect(session.getSnapshot().productsByReference.primary?.variables).toEqual({
      price: "$44.99",
    });

    transport.accept({
      event_name: "template_variables",
      variables: { products: [{ primary: { price: "$39.99" } }] },
    });
    supply("$29.99");
    expect(session.getSnapshot().productsByReference.primary?.variables).toEqual({
      price: "$39.99",
    });
  });

  it("never overwrites variables the host already sent", () => {
    const { session, transport } = createSession();
    transport.accept({
      event_name: "products",
      products: [{ product: "primary", productId: "pro_3999_year" }],
    });
    transport.accept({
      event_name: "template_variables",
      variables: { products: [{ primary: { price: "$39.99" } }] },
    });
    const before = session.getSnapshot();

    session.supplyProducts([
      { reference: "primary", productId: "live:price_1:no-trial", variables: { price: "$49.99" } },
    ]);

    expect(session.getSnapshot()).toBe(before);
  });

  it("keeps template variables without products from touching the product list", () => {
    const { session, transport } = createSession();
    const before = session.getSnapshot().products;
    transport.accept({ event_name: "template_variables", variables: { device: {} } });
    expect(session.getSnapshot().products).toBe(before);
  });
});

describe("variables", () => {
  it("exposes device, user, params and the experiment", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "template_variables",
      variables: {
        device: { platform: "iOS", locale: "en_US" },
        user: { firstName: "Ada" },
        params: { source: "onboarding" },
      },
    });
    transport.accept({
      event_name: "experiment",
      experimentId: "exp_1",
      variantId: "var_2",
      campaignId: "cmp_3",
    });

    const snapshot = session.getSnapshot();
    expect(snapshot.device).toEqual({ platform: "iOS", locale: "en_US" });
    expect(snapshot.user).toEqual({ firstName: "Ada" });
    expect(snapshot.params).toEqual({ source: "onboarding" });
    expect(snapshot.experiment).toEqual({
      experimentId: "exp_1",
      variantId: "var_2",
      campaignId: "cmp_3",
    });
  });
});

describe("introductory offer", () => {
  it("derives eligibility from the substitutions prefix", () => {
    const { session, transport } = createSession();
    expect(session.getSnapshot().introductoryOffer.eligible).toBeUndefined();

    transport.accept({ event_name: "template_substitutions_prefix", prefix: "freeTrial" });
    expect(session.getSnapshot().introductoryOffer.eligible).toBe(true);
    expect(session.getSnapshot().state).toMatchObject({ products: { hasIntroductoryOffer: true } });

    transport.accept({ event_name: "template_substitutions_prefix", prefix: null });
    expect(session.getSnapshot().introductoryOffer.eligible).toBe(false);
  });
});

describe("localization", () => {
  const config: SuperwallConfig = {
    localization: {
      defaultLocale: "en",
      messages: {
        en: { paywall: { title: "Go Pro", ctaTrial: "Start {days}-day free trial" } },
        de: { paywall: { title: "Hol dir Pro" } },
      },
    },
  };

  it("translates with interpolation and falls back to the key", () => {
    const { session } = createSession(config);
    expect(session.getSnapshot().locale).toBe("en");
    expect(session.t("paywall.title")).toBe("Go Pro");
    expect(session.t("paywall.ctaTrial", { days: 7 })).toBe("Start 7-day free trial");
    expect(session.t("Literal copy stays as-is")).toBe("Literal copy stays as-is");
  });

  it("resolves the locale from device variables and supports overrides", () => {
    const { session, transport } = createSession(config);

    transport.accept({
      event_name: "template_variables",
      variables: { device: { deviceLocale: "de_DE" } },
    });
    expect(session.getSnapshot().locale).toBe("de");
    expect(session.t("paywall.title")).toBe("Hol dir Pro");
    expect(session.t("paywall.ctaTrial", { days: 7 })).toBe("Start 7-day free trial");

    session.setLocale("en");
    expect(session.t("paywall.title")).toBe("Go Pro");
  });

  it("localizes period and periodly to the device locale and again on override", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "template_variables",
      variables: {
        device: { deviceLocale: "es_ES" },
        products: [{ primary: { price: "$39.99", period: "year", periodly: "yearly" } }],
      },
    });
    expect(session.getSnapshot().productsByReference.primary?.variables).toMatchObject({
      period: "año",
      periodly: "anual",
    });

    session.setLocale("pt_BR");
    expect(session.getSnapshot().productsByReference.primary?.variables.period).toBe("ano");

    session.setLocale(undefined);
    expect(session.getSnapshot().productsByReference.primary?.variables.period).toBe("año");
  });
});

describe("trial reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules the configured reminder on freeTrial_start, localized, for the open paywall", () => {
    const { transport } = createSession({
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

    expect(transport.outgoing.at(-1)).toEqual({
      event_name: "schedule_notification",
      id: "pw-identifier_TRIAL_STARTED",
      type: "TRIAL_STARTED",
      title: "Trial ending soon",
      body: "Plain body",
      delay: 6 * 24 * 60 * 60 * 1000,
    });
  });

  it("hands dynamic reminders the host's product", () => {
    const { transport } = createSession({
      products: { primary: "pro_3999_year" },
      notifications: {
        trialReminder: ({ product }) => ({
          title: product?.reference ?? "none",
          body: "b",
          delayMs: 1,
        }),
      },
    });

    transport.accept({
      event_name: "products",
      products: [{ product: "primary", productId: "pro_3999_year" }],
    });
    transport.accept({
      event_name: "freeTrial_start",
      product_identifier: "pro_3999_year",
      trial_end_date: "2026-07-23T00:00:00Z",
    });

    expect(transport.outgoing.at(-1)).toMatchObject({
      event_name: "schedule_notification",
      title: "primary",
    });
  });

  it("posts nothing without a schedulable reminder", () => {
    const { transport } = createSession({
      notifications: { trialReminder: { title: "T", body: "B" } },
    });
    transport.accept({ event_name: "freeTrial_start", product_identifier: "p" });
    expect(transport.outgoing).toEqual([]);
  });
});

describe("configure", () => {
  it("a late-arriving config never invents products", () => {
    const { session } = createSession();
    session.configure({ products: { primary: "pro_3999_year" } });
    expect(session.getSnapshot().products).toEqual([]);
    expect(session.getSnapshot().config).toEqual({ products: { primary: "pro_3999_year" } });
  });

  it("never overwrites host-delivered products and ignores the same config object", () => {
    const { session, transport } = createSession();
    transport.accept({
      event_name: "products",
      products: [{ product: "primary", productId: "sdk_product" }],
    });

    const config: SuperwallConfig = { products: { primary: "config_product" } };
    session.configure(config);
    expect(session.getSnapshot().productsByReference.primary?.productId).toBe("sdk_product");
    expect(session.getSnapshot().introductoryOffer).toEqual({});

    const before = session.getSnapshot();
    session.configure(config);
    expect(session.getSnapshot()).toBe(before);
  });
});

describe("start", () => {
  it("listens once and pings whenever asked", () => {
    const transport = new TestTransport();
    const session = createSuperwallSession({ transport });
    session.start({ sendPing: true });
    session.start({ sendPing: true });
    expect(session.getSnapshot().status).toBe("listening");
    expect(transport.outgoing.filter((message) => message.event_name === "ping")).toHaveLength(2);
  });
});

describe("events and subscriptions", () => {
  it("notifies typed event handlers and supports unsubscribe", () => {
    const { session, transport } = createSession();
    const onPaywallOpen = vi.fn();
    const onAnyMessage = vi.fn();
    const unsubscribe = session.on("paywall_open", onPaywallOpen);
    session.on("message", onAnyMessage);

    transport.accept({ event_name: "paywall_open", paywall_id: "pw_1", paywall_identifier: "pw" });
    expect(onPaywallOpen).toHaveBeenCalledWith(expect.objectContaining({ paywall_id: "pw_1" }));

    unsubscribe();
    transport.accept({ event_name: "paywall_open", paywall_id: "pw_2", paywall_identifier: "pw" });
    expect(onPaywallOpen).toHaveBeenCalledTimes(1);
    expect(onAnyMessage).toHaveBeenCalledTimes(2);
  });

  it("emits messages the session keeps no state for", () => {
    const { session, transport } = createSession();
    const seen: string[] = [];
    session.on("message", (message) => seen.push(message.event_name));
    transport.accept({ event_name: "substitution_editor_focused" });
    expect(seen).toEqual(["substitution_editor_focused"]);
  });

  it("notifies snapshot subscribers on changes and stops after unsubscribe", () => {
    const { session, transport } = createSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    transport.accept({ event_name: "template_substitutions_prefix", prefix: "freeTrial" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    transport.accept({ event_name: "template_substitutions_prefix", prefix: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("ingestion", () => {
  it("accept and accept64 route through the transport into the snapshot", () => {
    const { session } = createSession();

    session.accept([
      { event_name: "products", products: [{ product: "primary", productId: "pro" }] },
    ]);
    expect(session.getSnapshot().productsByReference.primary).toBeDefined();

    const batch = [
      {
        event_name: "template_variables",
        variables: { products: [{ primary: { price: "$9.99" } }] },
      },
    ];
    session.accept64(Buffer.from(JSON.stringify(batch), "utf8").toString("base64"));
    expect(session.getSnapshot().productsByReference.primary?.variables.price).toBe("$9.99");
  });

  it("reports an undecodable accept64 payload instead of throwing", () => {
    const transport = new TestTransport();
    const onDecodeError = vi.fn();
    const session = createSuperwallSession({ transport, onDecodeError });

    expect(() => session.accept64("not base64 json %%%")).not.toThrow();
    expect(onDecodeError).toHaveBeenCalledTimes(1);
    expect(() => createSuperwallSession({ transport }).accept64("%%%")).not.toThrow();
  });
});
