import { describe, expect, it } from "vitest";
import { OutgoingMessageSchema } from "../src/messages";

const accepts = (message: object) => expect(OutgoingMessageSchema.parse(message)).toEqual(message);
const rejects = (message: object) =>
  expect(OutgoingMessageSchema.safeParse(message).success).toBe(false);

describe("OutgoingMessageSchema", () => {
  it("parses the v4 handshake ping, bare and with every optional field", () => {
    accepts({ event_name: "ping", substitutions: [], page_styles: [], version: "4.0.0" });
    accepts({
      event_name: "ping",
      substitutions: [{ key: "title", value: "Go Pro" }],
      page_styles: [{ from: "#fff", to: "#000", property: "color" }],
      products: [{ product: "primary" }],
      coordinates: { title: { x: 1, y: 2 } },
      fonts: [{ family: "Inter" }],
    });
    rejects({ event_name: "ping" });
    rejects({
      event_name: "ping",
      substitutions: [],
      page_styles: [],
      products: [{ product: "fourth" }],
    });
  });

  it("parses the paywall's actions", () => {
    accepts({ event_name: "close" });
    accepts({ event_name: "restore" });
    accepts({ event_name: "open_url", url: "https://superwall.com" });
    accepts({ event_name: "open_url", url: "https://x", browser_type: "payment_sheet" });
    rejects({ event_name: "open_url", url: "https://x", browser_type: "tab" });
    accepts({ event_name: "open_url_external", url: "https://x" });
    accepts({ event_name: "open_deep_link", link: "app://x" });
    accepts({ event_name: "open_payment_sheet", url: "https://x" });
    accepts({ event_name: "custom", data: "payload" });
    accepts({ event_name: "custom_placement", name: "upsell", params: { source: "footer" } });
    accepts({ event_name: "request_store_review", review_type: "in-app" });
    rejects({ event_name: "request_store_review", review_type: "email" });
    accepts({ event_name: "user_attribute_updated", attributes: [{ key: "plan", value: "pro" }] });
    accepts({ event_name: "var_click", var_name: "title" });
    accepts({ event_name: "page_styles", page_styles: [] });
    accepts({ event_name: "has_set_dom", data: {} });
    accepts({ event_name: "haptic_feedback", haptic_type: "selection" });
    rejects({ event_name: "haptic_feedback", haptic_type: "thud" });
  });

  it("parses purchase with the reference and optional identifier and dismissal", () => {
    accepts({ event_name: "purchase", product: "primary" });
    accepts({
      event_name: "purchase",
      product: "primary",
      product_identifier: "pro",
      should_dismiss: false,
    });
    rejects({ event_name: "purchase" });
  });

  it("parses requests with their correlation ids", () => {
    accepts({
      event_name: "request_permission",
      permission_type: "camera",
      request_id: "permission-camera-1",
    });
    rejects({ event_name: "request_permission", permission_type: "camera" });
    accepts({
      event_name: "request_callback",
      request_id: "sync-blocking-1",
      name: "sync",
      behavior: "blocking",
    });
    accepts({
      event_name: "request_callback",
      request_id: "sync-non-blocking-1",
      name: "sync",
      behavior: "non-blocking",
      variables: { attempt: 1 },
    });
    rejects({ event_name: "request_callback", request_id: "r", name: "sync", behavior: "async" });
  });

  it("parses trial reminder scheduling and page views", () => {
    accepts({
      event_name: "schedule_notification",
      id: "pw_TRIAL_STARTED",
      type: "TRIAL_STARTED",
      title: "T",
      subtitle: "S",
      body: "B",
      delay: 1000,
    });
    rejects({
      event_name: "schedule_notification",
      id: "x",
      type: "OTHER",
      title: "T",
      body: "B",
      delay: 1,
    });
    accepts({
      event_name: "page_view",
      type: "forward",
      page_node_id: "goals",
      flow_position: 1,
      page_name: "goals",
      navigation_node_id: "nav",
      previous_page_node_id: "index",
      previous_flow_position: 0,
      time_on_previous_page_ms: 1200,
    });
    rejects({
      event_name: "page_view",
      type: "sideways",
      page_node_id: "x",
      flow_position: 0,
      page_name: "x",
      navigation_node_id: "n",
    });
  });

  it("parses a teleport: the external open it rides on, the background watch, and the redemption", () => {
    accepts({
      event_name: "open_url_external",
      url: "https://x",
      teleport: true,
      waiting_screen: true,
    });
    rejects({ event_name: "open_url_external", url: "https://x", teleport: "yes" });
    accepts({
      event_name: "teleport_watch_start",
      teleport_id: "v1:abc",
      teleport_status_url: "https://api/checkout/teleport/status",
      checkout_status_url: "https://api/checkout/status",
      public_api_key: "pk_1",
    });
    rejects({ event_name: "teleport_watch_start", teleport_id: "v1:abc" });
    accepts({ event_name: "teleport_watch_end" });
    accepts({
      event_name: "stripe_checkout_complete",
      checkout_context_id: "ctx",
      product_identifier: "p",
      should_dismiss: false,
    });
    rejects({
      event_name: "stripe_checkout_complete",
      checkout_context_id: "ctx",
      product_identifier: "p",
      should_dismiss: "no",
    });
  });

  it("parses the web checkout lifecycle the paywall reports to a host", () => {
    accepts({
      event_name: "initiate_web_checkout",
      checkout_context_id: "ctx",
      product_identifier: "live:price_1:trial",
      paywall_identifier: "pw",
      experiment_variant_id: "v1",
      presented_by_event_name: "campaign_trigger",
      store: "STRIPE",
    });
    rejects({
      event_name: "initiate_web_checkout",
      checkout_context_id: "ctx",
      product_identifier: "p",
      store: "PLAY",
    });
    for (const event_name of [
      "stripe_checkout_start",
      "stripe_checkout_prefetch",
      "stripe_checkout_abandon",
      "stripe_checkout_fail",
      "stripe_checkout_submit",
    ]) {
      accepts({ event_name, checkout_context_id: "ctx", product_identifier: "p" });
      rejects({ event_name, checkout_context_id: "ctx" });
    }
    accepts({
      event_name: "stripe_checkout_complete",
      checkout_context_id: "ctx",
      product_identifier: "p",
    });
    accepts({
      event_name: "stripe_checkout_complete",
      sw_checkout_id: null,
      checkout_context_id: "ctx",
      product_identifier: "p",
      post_purchase_resolution: { type: "redirect", url: "https://x" },
      post_purchase_behavior: "REDIRECT",
      entitlements_token: "token",
    });
    rejects({
      event_name: "stripe_checkout_complete",
      checkout_context_id: "ctx",
      product_identifier: "p",
      post_purchase_behavior: "PARTY",
    });
    accepts({
      event_name: "post_checkout_complete",
      checkout_context_id: "ctx",
      product_identifier: "p",
      transaction_data: {
        transaction_id: "t",
        product_identifier: "p",
        currency: "USD",
        value: 9.99,
      },
      redirect_url: "https://x",
      redemption_codes: ["redemption_abc"],
      post_purchase_behavior: "REDEEM",
      entitlements_token: "token",
    });
    accepts({
      event_name: "discount_redemption_result",
      code: "SPRING20",
      valid: false,
      reason: "code_not_found",
    });
    accepts({
      event_name: "discount_redemption_result",
      code: "SPRING20",
      valid: true,
      appliedProductCount: 2,
    });
    rejects({ event_name: "discount_redemption_result", code: "SPRING20" });
  });

  it("rejects unknown event names", () => {
    rejects({ event_name: "nope" });
  });
});
