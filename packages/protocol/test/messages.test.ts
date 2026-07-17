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
