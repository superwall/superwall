import { describe, expect, it } from "vitest";
import { createSuperwallSession } from "../src/session";
import { TestTransport } from "./testTransport";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const createSession = () => {
  const transport = new TestTransport();
  const session = createSuperwallSession({ transport });
  session.start();
  return { session, transport };
};

const lastOutgoing = (transport: TestTransport) => transport.outgoing.at(-1);

describe("SuperwallSession actions", () => {
  it("close, restore, and custom send the expected messages", () => {
    const { session, transport } = createSession();

    session.close();
    expect(lastOutgoing(transport)).toEqual({ event_name: "close" });

    session.restore();
    expect(lastOutgoing(transport)).toEqual({ event_name: "restore" });

    session.custom("payload");
    expect(lastOutgoing(transport)).toEqual({ event_name: "custom", data: "payload" });
  });

  it("url and deep link actions carry their targets", () => {
    const { session, transport } = createSession();

    session.openUrl("https://superwall.com");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "open_url",
      url: "https://superwall.com",
      browser_type: undefined,
    });

    session.openUrl("https://superwall.com", { browserType: "payment_sheet" });
    expect(lastOutgoing(transport)).toMatchObject({ browser_type: "payment_sheet" });

    session.openExternalUrl("https://superwall.com/docs");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "open_url_external",
      url: "https://superwall.com/docs",
    });

    session.openDeepLink("app://settings");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "open_deep_link",
      link: "app://settings",
    });
  });

  it("custom placements, store review, attributes, and haptics", () => {
    const { session, transport } = createSession();

    session.customPlacement("upsell_shown", { source: "footer" });
    expect(lastOutgoing(transport)).toEqual({
      event_name: "custom_placement",
      name: "upsell_shown",
      params: { source: "footer" },
    });

    session.requestStoreReview("in-app");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "request_store_review",
      review_type: "in-app",
    });

    session.setUserAttributes({ plan: "pro" });
    expect(lastOutgoing(transport)).toEqual({
      event_name: "user_attribute_updated",
      attributes: [{ key: "plan", value: "pro" }],
    });

    session.hapticFeedback("selection");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "haptic_feedback",
      haptic_type: "selection",
    });
  });

  it("manual trial reminders schedule TRIAL_STARTED notifications", () => {
    const { session, transport } = createSession();

    session.scheduleTrialReminder({
      id: "custom",
      title: "T",
      body: "B",
      delayMs: 1000,
    });

    expect(lastOutgoing(transport)).toMatchObject({
      event_name: "schedule_notification",
      id: "custom",
      type: "TRIAL_STARTED",
      delay: 1000,
    });
  });
});

describe("SuperwallSession requests", () => {
  it("requestPermission posts a correlated request and stores the camelCased status", async () => {
    const { session, transport } = createSession();

    const permissionPromise = session.requestPermission("background_location");
    const outgoing = lastOutgoing(transport) as { request_id: string };
    expect(outgoing).toMatchObject({
      event_name: "request_permission",
      permission_type: "background_location",
    });

    transport.accept({
      event_name: "permission_result",
      permission_type: "background_location",
      request_id: outgoing.request_id,
      status: "granted",
    });

    await expect(permissionPromise).resolves.toBe("granted");
    expect(session.getSnapshot().permissionStatuses.backgroundLocation).toBe("granted");
  });

  it("requestCallback correlates results and camelCases state names", async () => {
    const { session, transport } = createSession();

    const callbackPromise = session.requestCallback("sync entitlements!", {
      behavior: "non-blocking",
      variables: { attempt: 1 },
    });
    const outgoing = lastOutgoing(transport) as { request_id: string };
    expect(outgoing).toMatchObject({
      event_name: "request_callback",
      name: "sync entitlements!",
      behavior: "non-blocking",
      variables: { attempt: 1 },
    });

    transport.accept({
      event_name: "callback_result",
      request_id: outgoing.request_id,
      name: "sync entitlements!",
      status: "success",
      data: { synced: true },
    });

    await expect(callbackPromise).resolves.toMatchObject({
      status: "success",
      data: { synced: true },
    });
    expect(session.getSnapshot().callbackStates.syncEntitlements).toEqual({
      result: "success",
      data: { synced: true },
    });
  });

  it("stores callback results that arrive without a pending request", () => {
    const { session, transport } = createSession();

    transport.accept({
      event_name: "callback_result",
      request_id: "unknown",
      name: "server push",
      status: "failure",
    });

    expect(session.getSnapshot().callbackStates.serverPush).toMatchObject({
      result: "failure",
    });
  });
});

describe("SuperwallSession ingestion", () => {
  it("accept and accept64 route through the bridge into the snapshot", () => {
    const { session } = createSession();

    session.accept([
      { event_name: "products", products: [{ product: "primary", productId: "pro" }] },
    ]);
    expect(session.getSnapshot().productsByReference.primary).toBeDefined();

    session.accept64(
      encode([
        {
          event_name: "template_variables",
          variables: { products: [{ primary: { price: "$9.99" } }] },
        },
      ]),
    );
    expect(session.getSnapshot().productsByReference.primary?.variables.price).toBe("$9.99");
  });

  it("keeps unknown messages in the log and emits them as events", () => {
    const { session, transport } = createSession();
    const seen: string[] = [];
    session.on("message", (message) => seen.push(message.event_name));

    transport.accept({ event_name: "substitution_editor_focused" });

    expect(seen).toEqual(["substitution_editor_focused"]);
    expect(session.getSnapshot().messages.at(-1)?.msg.event_name).toBe(
      "substitution_editor_focused",
    );
  });
});
