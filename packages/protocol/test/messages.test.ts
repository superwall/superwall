import { describe, expect, it } from "vitest";
import { IncomingMessageSchema } from "../src/messages";

describe("IncomingMessageSchema", () => {
  it("parses template_variables", () => {
    const message = {
      event_name: "template_variables",
      variables: {
        device: { locale: "en_US", platform: "iOS" },
        user: { firstName: "Ada" },
      },
    };
    expect(IncomingMessageSchema.parse(message)).toEqual(message);
  });

  it("parses template_substitutions_prefix with a null prefix", () => {
    const message = { event_name: "template_substitutions_prefix", prefix: null };
    expect(IncomingMessageSchema.parse(message)).toEqual(message);

    const trial = { event_name: "template_substitutions_prefix", prefix: "freeTrial" };
    expect(IncomingMessageSchema.parse(trial)).toEqual(trial);
  });

  it("parses callback_result with and without data", () => {
    const withData = {
      event_name: "callback_result",
      request_id: "syncUser-blocking-123",
      name: "syncUser",
      status: "success",
      data: { plan: "pro" },
    };
    expect(IncomingMessageSchema.parse(withData)).toEqual(withData);

    const withoutData = {
      event_name: "callback_result",
      request_id: "syncUser-blocking-123",
      name: "syncUser",
      status: "failure",
    };
    expect(IncomingMessageSchema.parse(withoutData)).toEqual(withoutData);
  });

  it("parses editor substitution focus/blur events", () => {
    expect(IncomingMessageSchema.parse({ event_name: "substitution_editor_focused" })).toEqual({
      event_name: "substitution_editor_focused",
    });
    expect(IncomingMessageSchema.parse({ event_name: "substitution_editor_blurred" })).toEqual({
      event_name: "substitution_editor_blurred",
    });
  });

  it("parses the SDK transaction lifecycle with and without a product", () => {
    for (const event_name of [
      "transaction_start",
      "transaction_fail",
      "transaction_timeout",
      "transaction_restore",
    ]) {
      expect(IncomingMessageSchema.parse({ event_name })).toEqual({ event_name });
      const withProduct = { event_name, product_identifier: "com.app.annual", product: "primary" };
      expect(IncomingMessageSchema.parse(withProduct)).toEqual(withProduct);
    }
  });

  it("parses the restore lifecycle and paywall_close", () => {
    for (const event_name of ["restore_start", "restore_complete", "restore_fail"]) {
      expect(IncomingMessageSchema.parse({ event_name })).toEqual({ event_name });
    }
    expect(IncomingMessageSchema.parse({ event_name: "paywall_close" })).toEqual({
      event_name: "paywall_close",
    });
    const identified = {
      event_name: "paywall_close",
      paywall_id: "123",
      paywall_identifier: "my_paywall",
    };
    expect(IncomingMessageSchema.parse(identified)).toEqual(identified);
  });

  it("parses event_tracking_behavior and rejects unknown behaviors", () => {
    for (const behavior of ["all", "superwallOnly", "none"]) {
      const message = { event_name: "event_tracking_behavior", behavior };
      expect(IncomingMessageSchema.parse(message)).toEqual(message);
    }
    expect(
      IncomingMessageSchema.safeParse({ event_name: "event_tracking_behavior", behavior: "some" })
        .success,
    ).toBe(false);
    expect(IncomingMessageSchema.safeParse({ event_name: "event_tracking_behavior" }).success).toBe(
      false,
    );
  });

  it("rejects transaction lifecycle messages with non-string products", () => {
    expect(
      IncomingMessageSchema.safeParse({ event_name: "transaction_fail", product_identifier: 42 })
        .success,
    ).toBe(false);
    expect(
      IncomingMessageSchema.safeParse({ event_name: "paywall_close", paywall_id: 123 }).success,
    ).toBe(false);
  });

  it("rejects unknown event names", () => {
    expect(IncomingMessageSchema.safeParse({ event_name: "nope" }).success).toBe(false);
  });

  it("rejects structurally invalid known messages", () => {
    // callback_result without its correlation id must not parse
    const result = IncomingMessageSchema.safeParse({
      event_name: "callback_result",
      name: "syncUser",
      status: "success",
    });
    expect(result.success).toBe(false);
  });
});
