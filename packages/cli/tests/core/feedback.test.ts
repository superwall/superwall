import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedbackEvent } from "@/core/feedback";

test("feedback event carries the message, source, and follow-up contact", () => {
  const event = buildFeedbackEvent(
    "migrate crashed on Expo",
    "agent",
    "3e37f5f0-0000-4000-8000-000000000000",
    { userEmail: "dev@acme.com", orgId: "42", orgName: "Acme" },
  ) as {
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  };

  assert.equal(event.event, "feedback submitted");
  assert.equal(event.distinct_id, "3e37f5f0-0000-4000-8000-000000000000");
  assert.equal(event.properties.message, "migrate crashed on Expo");
  assert.equal(event.properties.via, "agent");
  assert.equal(event.properties.email, "dev@acme.com");
  assert.equal(event.properties.org_name, "Acme");
  assert.equal(typeof event.properties.cli_version, "string");
});

test("feedback event is contact-free when logged out", () => {
  const event = buildFeedbackEvent("nice tool", "human", "anon-id", null) as {
    properties: Record<string, unknown>;
  };
  assert.equal(event.properties.email, null);
  assert.equal(event.properties.org_id, null);
  assert.equal(event.properties.via, "human");
});
