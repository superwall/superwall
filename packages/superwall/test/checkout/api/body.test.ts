import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallProduct, SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { allowedDirectivesFor, identityOf, sessionBody } from "../../../src/checkout/api/body";

const product: SuperwallProduct = {
  reference: "primary",
  productId: "test:price_1:no-trial",
  variables: { price: "$19.99", rawPrice: "19.99", period: "month" },
  source: "sdk",
};

const snapshotOf = (overrides: Record<string, unknown> = {}): SuperwallRuntimeSnapshot =>
  ({
    device: {},
    user: {},
    params: {},
    products: [product],
    productsByReference: { primary: product },
    introductoryOffer: { eligible: false },
    ...overrides,
  }) as unknown as SuperwallRuntimeSnapshot;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("allowedDirectivesFor", () => {
  it("asks for what each mode can act on", () => {
    expect(allowedDirectivesFor("external")).toEqual(["redirect"]);
    expect(allowedDirectivesFor("sheet")).toEqual(["embedded", "redirect"]);
    expect(allowedDirectivesFor("applePay")).toEqual(["elements", "embedded", "redirect"]);
  });
});

describe("identityOf", () => {
  it("prefers the SDK's app user id, then the placement params, then the device", () => {
    expect(
      identityOf(
        snapshotOf({ user: { appUserId: "user_1", email: "a@b.co", aliasId: "alias_1" } }),
      ),
    ).toMatchObject({ appUserId: "user_1", aliasId: "alias_1", email: "a@b.co" });

    expect(identityOf(snapshotOf({ params: { app_user_id: "from_params" } })).appUserId).toBe(
      "from_params",
    );
    expect(identityOf(snapshotOf({ params: { user: "from_user" } })).appUserId).toBe("from_user");
    expect(identityOf(snapshotOf({ params: { uid: "from_uid" } })).appUserId).toBe("from_uid");
    expect(identityOf(snapshotOf({ device: { appUserId: "from_device" } })).appUserId).toBe(
      "from_device",
    );
    expect(identityOf(snapshotOf({ user: { aliasId: "alias_only" } })).appUserId).toBe(
      "alias_only",
    );
  });

  it("invents an alias when the SDK named nobody", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-2222-3333-4444-555555555555");
    const identity = identityOf(snapshotOf());
    expect(identity.appUserId).toBe("$SuperwallAlias:11111111-2222-3333-4444-555555555555");
    expect(identity.deviceId).toBe("$SuperwallDevice:11111111-2222-3333-4444-555555555555");
    expect(identity.aliasId).toBeNull();
    expect(identity.email).toBeNull();
  });

  it("prefers the vendor id everywhere but Android, which reports a non-UUID one", () => {
    expect(
      identityOf(snapshotOf({ device: { platform: "iOS", vendorId: "v1", deviceId: "d1" } }))
        .deviceId,
    ).toBe("$SuperwallDevice:v1");
    expect(
      identityOf(snapshotOf({ device: { platform: "Android", vendorId: "v1", deviceId: "d1" } }))
        .deviceId,
    ).toBe("$SuperwallDevice:d1");
    expect(
      identityOf(snapshotOf({ device: { platform: "Android", vendorId: "v1" } })).deviceId,
    ).toBe("$SuperwallDevice:v1");
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-2222-3333-4444-555555555555");
    expect(identityOf(snapshotOf({ device: { deviceId: "d1" } })).deviceId).toBe(
      "$SuperwallDevice:11111111-2222-3333-4444-555555555555",
    );
  });

  it("leaves an already-prefixed device id alone", () => {
    expect(identityOf(snapshotOf({ device: { vendorId: "$SuperwallDevice:v1" } })).deviceId).toBe(
      "$SuperwallDevice:v1",
    );
  });

  it("treats an empty email as none", () => {
    expect(identityOf(snapshotOf({ user: { email: "" } })).email).toBeNull();
  });
});

describe("sessionBody", () => {
  const bodyOf = (overrides: Record<string, unknown> = {}, silent = false) =>
    sessionBody({
      snapshot: snapshotOf(overrides),
      product,
      productIdentifier: "test:price_1:no-trial",
      mode: "sheet",
      silent,
    });

  it("carries the paywall, experiment and presentment context the v4 API expects", () => {
    const body = bodyOf({
      paywall: { id: "42", identifier: "pw_42" },
      experiment: { experimentId: "e1", variantId: "v1" },
      params: { event_name: "campaign_trigger", event_id: "evt_1" },
      introductoryOffer: { eligible: true },
      device: { platform: "iOS", publicApiKey: "pk_test", deviceModel: "iPhone17,1" },
    });

    expect(body.context.paywall).toMatchObject({
      paywallId: "42",
      paywallIdentifier: "pw_42",
      paywallProductIds: "test:price_1:no-trial",
    });
    expect(body.context.experiment).toEqual({ experimentId: "e1", variantId: "v1" });
    expect(body.context.presentment).toMatchObject({
      isFreeTrialAvailable: true,
      presentedByEventName: "campaign_trigger",
      presentedByEventId: "evt_1",
    });
    expect(body.context.device).toMatchObject({ platform: "iOS", deviceModel: "iPhone17,1" });
    expect(body.isPrefetch).toBe(false);
    expect(body.deferElementsIntentCreation).toBe(false);
  });

  it("attributes to the presentation the SDK reported on paywall_open, as paywall.js does", () => {
    const body = bodyOf({
      paywall: {
        id: "42",
        identifier: "pw_42",
        presentation: {
          id: "pres-1",
          presentedBy: "event",
          sourceType: "getPaywall",
          eventId: "evt-1",
          eventName: "campaign_trigger",
        },
      },
      params: { event_name: "from_params", event_id: "from-params" },
    });
    expect(body.context.presentment).toEqual({
      isFreeTrialAvailable: false,
      presentedBy: "event",
      presentationSourceType: "getPaywall",
      presentedByEventName: "campaign_trigger",
      presentedByEventId: "evt-1",
    });

    const fromParams = bodyOf({ params: { event_name: "from_params", event_id: "from-params" } });
    expect(fromParams.context.presentment).toMatchObject({
      presentedByEventName: "from_params",
      presentedByEventId: "from-params",
    });
  });

  it("defaults the ids the SDK has not sent yet and calls the platform web", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-2222-3333-4444-555555555555");
    const body = bodyOf();

    expect(body.context.paywall).toMatchObject({ paywallId: "0", paywallIdentifier: "" });
    expect(body.context.experiment).toEqual({ experimentId: "0", variantId: "0" });
    expect(body.context.presentment).toEqual({
      isFreeTrialAvailable: false,
      presentedBy: "placement",
      presentationSourceType: "register",
      presentedByEventName: "",
      presentedByEventId: "fa3c2ba4-01c4-463d-ac3c-c58a32c6f0c6",
    });
    expect(body.context.device.platform).toBe("web");
    expect(body.context.device.appInstallDate).toBeUndefined();
  });

  it("names a prefetch as one", () => {
    expect(bodyOf({}, true).isPrefetch).toBe(true);
  });

  it("sends the Stripe customer the SDK knows about, and omits an empty one", () => {
    expect(bodyOf({ user: { stripe_customer_id: "cus_1" } })).toMatchObject({
      stripeCustomerId: "cus_1",
    });
    expect(bodyOf({ user: { stripe_customer_id: "" } })).not.toHaveProperty("stripeCustomerId");
  });

  it("sends the managed-payments override only when the config takes a side", () => {
    expect(
      bodyOf({ config: { checkout: { mode: "sheet", managedPayments: true } } }).context,
    ).toMatchObject({ paywallManagedPaymentsOverride: "USE_MANAGED_PAYMENTS" });
    expect(
      bodyOf({ config: { checkout: { mode: "sheet", managedPayments: false } } }).context,
    ).toMatchObject({ paywallManagedPaymentsOverride: "USE_DEFAULT_PAYMENTS" });
    expect(bodyOf({ config: { checkout: "sheet" } }).context).not.toHaveProperty(
      "paywallManagedPaymentsOverride",
    );
    expect(bodyOf().context).not.toHaveProperty("paywallManagedPaymentsOverride");
  });

  it("defaults product variables the store did not price", () => {
    const body = sessionBody({
      snapshot: snapshotOf(),
      product: { reference: "primary", variables: {}, source: "sdk" },
      productIdentifier: "test:price_1:no-trial",
      mode: "applePay",
      silent: false,
    });

    expect(body.context.product).toMatchObject({
      currencyCode: "USD",
      currencySymbol: "$",
      price: "",
      rawPrice: 0,
      periodDays: 0,
    });
    expect(body.deferElementsIntentCreation).toBe(true);
    expect(body.allowedCheckoutDirectives).toEqual(["elements", "embedded", "redirect"]);
  });

  it("names the teleport a session is made on, and only then", () => {
    const body = sessionBody({
      snapshot: snapshotOf(),
      product,
      productIdentifier: "test:price_1:no-trial",
      mode: "sheet",
      silent: false,
      teleportId: "v1:tp",
    });
    expect(body.teleportId).toBe("v1:tp");
    expect(bodyOf()).not.toHaveProperty("teleportId");
  });

  it("lists only the products the store priced", () => {
    const body = sessionBody({
      snapshot: snapshotOf({
        products: [product, { reference: "secondary", variables: {}, source: "sdk" }],
      }),
      product,
      productIdentifier: "test:price_1:no-trial",
      mode: "sheet",
      silent: false,
    });
    expect(body.context.paywall.paywallProductIds).toBe("test:price_1:no-trial");
  });
});
