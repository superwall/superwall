import { describe, expect, it } from "vitest";
import { OutgoingMessageSchema } from "@superwall/protocol";
import { createSuperwallProduct } from "../../src/products";
import * as outgoing from "../../src/session/outgoing";

describe("outgoing message builders", () => {
  const product = createSuperwallProduct({ reference: "primary", productId: "pro" });

  const every = [
    outgoing.ping(),
    outgoing.close(),
    outgoing.restore(),
    outgoing.openUrl("https://superwall.com"),
    outgoing.openUrl("https://superwall.com", "payment_sheet"),
    outgoing.openExternalUrl("https://superwall.com/docs"),
    outgoing.openDeepLink("app://settings"),
    outgoing.custom("open_settings"),
    outgoing.customPlacement("upsell_shown", { source: "footer" }),
    outgoing.requestStoreReview("in-app"),
    outgoing.hapticFeedback("selection"),
    outgoing.pageView({ type: "entry", name: "index", navigationId: "nav", position: 0 }),
    outgoing.pageView({
      type: "forward",
      name: "goals",
      navigationId: "nav",
      position: 2,
      previousName: "index",
      previousPosition: 1,
      timeOnPreviousMs: 1200,
    }),
    outgoing.scheduleNotification({ id: "x", title: "T", body: "B", delayMs: 1000 }),
    outgoing.scheduleNotification({ id: "x", title: "T", subtitle: "S", body: "B", delayMs: 1 }),
    outgoing.requestPermission("notification", "permission-notification-1"),
    outgoing.requestCallback({ requestId: "sync-blocking-1", name: "sync", behavior: "blocking" }),
    outgoing.requestCallback({
      requestId: "sync-non-blocking-1",
      name: "sync",
      behavior: "non-blocking",
      variables: { attempt: 1 },
    }),
    outgoing.purchase(product, undefined),
    outgoing.purchase(createSuperwallProduct("bare"), true),
  ];

  it.each(every.map((message) => [message.event_name, message] as const))(
    "%s is a valid protocol message",
    (_, message) => {
      expect(OutgoingMessageSchema.parse(message)).toEqual(message);
    },
  );

  it("sends the v4 handshake ping and nothing more", () => {
    expect(outgoing.ping()).toEqual({
      event_name: "ping",
      substitutions: [],
      page_styles: [],
      version: outgoing.PING_VERSION,
    });
  });

  it("omits optional keys it has no value for", () => {
    expect(outgoing.openUrl("u")).toEqual({ event_name: "open_url", url: "u" });
    expect(
      outgoing.pageView({ type: "entry", name: "index", navigationId: "n", position: 0 }),
    ).toEqual({
      event_name: "page_view",
      type: "entry",
      page_name: "index",
      page_node_id: "index",
      navigation_node_id: "n",
      flow_position: 0,
    });
    expect(outgoing.purchase(createSuperwallProduct("bare"), undefined)).toEqual({
      event_name: "purchase",
      product: "bare",
    });
  });

  it("carries the store identifier and dismissal on a purchase", () => {
    expect(outgoing.purchase(product, false)).toEqual({
      event_name: "purchase",
      product: "primary",
      product_identifier: "pro",
      should_dismiss: false,
    });
  });
});
