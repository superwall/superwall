import { describe, expect, it } from "vitest";
import { createSuperwallSession } from "../../src/session";
import { TestTransport } from "../support/testTransport";

const createSession = () => {
  const transport = new TestTransport();
  const session = createSuperwallSession({ transport });
  session.start();
  return { session, transport };
};

const lastOutgoing = (transport: TestTransport) => transport.outgoing.at(-1);

describe("actions", () => {
  it("close and restore send the SDK's messages", () => {
    const { session, transport } = createSession();
    session.close();
    expect(lastOutgoing(transport)).toEqual({ event_name: "close" });
    session.restore();
    expect(lastOutgoing(transport)).toEqual({ event_name: "restore" });
  });

  it("url and deep link actions carry their targets", () => {
    const { session, transport } = createSession();

    session.openUrl("https://superwall.com");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "open_url",
      url: "https://superwall.com",
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

  it("custom actions send the name as the custom message's data", () => {
    const { session, transport } = createSession();
    session.customAction("open_settings");
    expect(lastOutgoing(transport)).toEqual({ event_name: "custom", data: "open_settings" });
  });

  it("custom placements, store review and haptics", () => {
    const { session, transport } = createSession();

    session.customPlacement("upsell_shown", { source: "footer" });
    expect(lastOutgoing(transport)).toEqual({
      event_name: "custom_placement",
      name: "upsell_shown",
      params: { source: "footer" },
    });
    session.customPlacement("bare");
    expect(lastOutgoing(transport)).toMatchObject({ params: {} });
    session.requestStoreReview("in-app");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "request_store_review",
      review_type: "in-app",
    });
    session.hapticFeedback("selection");
    expect(lastOutgoing(transport)).toEqual({
      event_name: "haptic_feedback",
      haptic_type: "selection",
    });
  });

  it("page views carry the screen as both name and node id", () => {
    const { session, transport } = createSession();
    session.pageView({
      type: "forward",
      name: "goals/experience",
      navigationId: "get-started",
      position: 2,
      previousName: "goals",
      previousPosition: 1,
      timeOnPreviousMs: 1200,
    });
    expect(lastOutgoing(transport)).toEqual({
      event_name: "page_view",
      type: "forward",
      page_name: "goals/experience",
      page_node_id: "goals/experience",
      navigation_node_id: "get-started",
      flow_position: 2,
      previous_page_node_id: "goals",
      previous_flow_position: 1,
      time_on_previous_page_ms: 1200,
    });
  });
});

describe("requests", () => {
  it("requestPermission posts a correlated request and stores the camelCased status", async () => {
    const { session, transport } = createSession();

    const permission = session.requestPermission("background_location");
    const outgoing = lastOutgoing(transport);
    if (outgoing?.event_name !== "request_permission") throw new Error("no request");
    expect(outgoing.permission_type).toBe("background_location");

    transport.accept({
      event_name: "permission_result",
      permission_type: "background_location",
      request_id: outgoing.request_id,
      status: "granted",
    });

    await expect(permission).resolves.toBe("granted");
    expect(session.getSnapshot().permissionStatuses.backgroundLocation).toBe("granted");
  });

  it("requestCallback correlates results and camelCases state names", async () => {
    const { session, transport } = createSession();

    const callback = session.requestCallback("sync entitlements!", {
      behavior: "non-blocking",
      variables: { attempt: 1 },
    });
    const outgoing = lastOutgoing(transport);
    if (outgoing?.event_name !== "request_callback") throw new Error("no request");
    expect(outgoing).toMatchObject({
      name: "sync entitlements!",
      behavior: "non-blocking",
      variables: { attempt: 1 },
    });
    expect(outgoing.request_id).toMatch(/^syncEntitlements-non-blocking-/);

    transport.accept({
      event_name: "callback_result",
      request_id: outgoing.request_id,
      name: "sync entitlements!",
      status: "success",
      data: { synced: true },
    });

    await expect(callback).resolves.toMatchObject({ status: "success", data: { synced: true } });
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
    expect(session.getSnapshot().callbackStates.serverPush).toEqual({
      result: "failure",
      data: undefined,
    });
  });
});
