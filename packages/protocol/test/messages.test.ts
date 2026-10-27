import { describe, expect, it } from "vitest";
import { IncomingMessageSchema } from "../src/messages";

const accepts = (message: object) => expect(IncomingMessageSchema.parse(message)).toEqual(message);
const rejects = (message: object) =>
  expect(IncomingMessageSchema.safeParse(message).success).toBe(false);

describe("IncomingMessageSchema", () => {
  it("parses template_variables", () => {
    accepts({
      event_name: "template_variables",
      variables: { device: { locale: "en_US", platform: "iOS" }, user: { firstName: "Ada" } },
    });
    rejects({ event_name: "template_variables" });
  });

  it("parses template_substitutions_prefix with a null prefix", () => {
    accepts({ event_name: "template_substitutions_prefix", prefix: null });
    accepts({ event_name: "template_substitutions_prefix", prefix: "freeTrial" });
    rejects({ event_name: "template_substitutions_prefix" });
  });

  it("parses products and experiment", () => {
    accepts({ event_name: "products", products: [{ product: "primary", productId: "pro" }] });
    rejects({ event_name: "products", products: [{ product: "primary" }] });
    accepts({ event_name: "experiment", experimentId: "e", variantId: "v", campaignId: "c" });
    rejects({ event_name: "experiment", experimentId: "e" });
  });

  it("parses paywall_open and paywall_close", () => {
    accepts({ event_name: "paywall_open", paywall_id: "123", paywall_identifier: "my_paywall" });
    rejects({ event_name: "paywall_open" });
    accepts({
      event_name: "paywall_open",
      paywall_id: "123",
      paywall_identifier: "my_paywall",
      presentation_id: "p-1",
      presented_by: "event",
      presentation_source_type: "getPaywall",
      presented_by_event_id: "e-1",
      presented_by_event_name: "campaign_trigger",
    });
    rejects({ event_name: "paywall_open", paywall_id: "123", paywall_identifier: "x", presentation_id: 7 });
    accepts({ event_name: "paywall_close" });
    accepts({ event_name: "paywall_close", paywall_id: "123", paywall_identifier: "my_paywall" });
    rejects({ event_name: "paywall_close", paywall_id: 123 });
  });

  it("parses the SDK transaction lifecycle with and without a product", () => {
    for (const event_name of [
      "transaction_start",
      "transaction_complete",
      "transaction_abandon",
      "transaction_fail",
      "transaction_timeout",
      "transaction_restore",
    ]) {
      accepts({ event_name });
      accepts({ event_name, product_identifier: "com.app.annual", product: "primary" });
      rejects({ event_name, product_identifier: 42 });
    }
  });

  it("parses freeTrial_start with the epoch iOS sends or an ISO string", () => {
    accepts({ event_name: "freeTrial_start" });
    accepts({
      event_name: "freeTrial_start",
      product_identifier: "p",
      trial_end_date: 1758000000000,
    });
    accepts({ event_name: "freeTrial_start", trial_end_date: "2026-07-23T00:00:00Z" });
    rejects({ event_name: "freeTrial_start", trial_end_date: true });
  });

  it("parses the restore lifecycle", () => {
    for (const event_name of ["restore_start", "restore_complete", "restore_fail"]) {
      accepts({ event_name });
    }
  });

  it("parses back_button_input the way Android sends it, with no payload", () => {
    accepts({ event_name: "back_button_input" });
    expect(
      IncomingMessageSchema.parse({
        event_name: "back_button_input",
        paywall_id: "123",
        paywall_identifier: "my_paywall",
      }),
    ).toEqual({ event_name: "back_button_input" });
  });

  it("parses game controller input in both shapes", () => {
    accepts({
      event_name: "game_controller_input",
      controller_element: "leftThumbstick",
      directional: true,
      x: 0.5,
      y: -0.5,
    });
    accepts({
      event_name: "game_controller_input",
      controller_element: "buttonA",
      directional: false,
      value: 1,
    });
    rejects({
      event_name: "game_controller_input",
      controller_element: "buttonA",
      directional: false,
    });
  });

  it("parses permission_result and callback_result", () => {
    accepts({
      event_name: "permission_result",
      permission_type: "notification",
      request_id: "permission-notification-1",
      status: "granted",
    });
    rejects({
      event_name: "permission_result",
      permission_type: "telepathy",
      request_id: "r",
      status: "granted",
    });
    accepts({
      event_name: "callback_result",
      request_id: "syncUser-blocking-123",
      name: "syncUser",
      status: "success",
      data: { plan: "pro" },
    });
    accepts({
      event_name: "callback_result",
      request_id: "syncUser-blocking-123",
      name: "syncUser",
      status: "failure",
    });
    rejects({ event_name: "callback_result", name: "syncUser", status: "success" });
  });

  it("parses event_tracking_behavior and rejects unknown behaviors", () => {
    for (const behavior of ["all", "superwallOnly", "none"]) {
      accepts({ event_name: "event_tracking_behavior", behavior });
    }
    rejects({ event_name: "event_tracking_behavior", behavior: "some" });
    rejects({ event_name: "event_tracking_behavior" });
  });

  it("parses redeem_discount from a host", () => {
    accepts({ event_name: "redeem_discount", code: "SPRING20" });
    rejects({ event_name: "redeem_discount" });
  });

  it("parses the editor-only messages the runtime ignores", () => {
    accepts({ event_name: "substitution_editor_focused" });
    accepts({ event_name: "substitution_editor_blurred" });
    accepts({ event_name: "focus_substitution", key: "title" });
    accepts({ event_name: "unfocus_substitution" });
    accepts({ event_name: "focus_hovered_substitution", key: "title" });
    accepts({ event_name: "unfocus_hovered_substitution" });
    accepts({ event_name: "application_settings", settings: [] });
    accepts({ event_name: "paywall_settings", settings: [{ anything: true }] });
    accepts({ event_name: "template_json", json: { a: 1 }, reset: true });
    accepts({
      event_name: "page_styles",
      pageStyles: [{ from: "#fff", to: "#000", property: "backgroundColor" }],
    });
    accepts({
      event_name: "template_substitutions",
      substitutions: [{ key: "title", value: "x" }],
    });
    rejects({ event_name: "template_substitutions" });
  });

  it("rejects unknown event names", () => {
    rejects({ event_name: "nope" });
  });
});
