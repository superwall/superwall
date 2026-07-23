import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, flushTelemetry, isTelemetryEnabled, setTelemetryTags } from "@/core/telemetry";

const KEY = "phc_test";

test("telemetry is disabled by opt-out env vars, a missing key, and test runs", () => {
  assert.equal(isTelemetryEnabled({}, KEY), true);
  assert.equal(isTelemetryEnabled({}, ""), false);
  assert.equal(isTelemetryEnabled({ DO_NOT_TRACK: "1" }, KEY), false);
  assert.equal(isTelemetryEnabled({ SUPERWALL_TELEMETRY_DISABLED: "1" }, KEY), false);
  assert.equal(isTelemetryEnabled({ NODE_TEST_CONTEXT: "child-v8" }, KEY), false);
});

test("this test run itself is telemetry-disabled via NODE_TEST_CONTEXT", () => {
  assert.ok(process.env.NODE_TEST_CONTEXT);
});

test("events are anonymous: uuid distinct_id, enum props, no person profile", () => {
  setTelemetryTags({ framework: "expo", driver: "claude" });
  const event = buildEvent(
    "workflow finished",
    { workflow: "integrate", status: "success", duration_ms: 1200 },
    "3e37f5f0-0000-4000-8000-000000000000",
  ) as {
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  };

  assert.equal(event.event, "workflow finished");
  assert.equal(event.distinct_id, "3e37f5f0-0000-4000-8000-000000000000");
  assert.equal(event.properties.$process_person_profile, false);
  assert.equal(event.properties.framework, "expo");
  assert.equal(event.properties.driver, "claude");
  assert.equal(event.properties.status, "success");
  assert.equal(typeof event.properties.cli_version, "string");
  assert.equal(typeof event.properties.ci, "boolean");
  assert.equal(typeof event.properties.interactive, "boolean");
  // Every property is an enum/boolean/number - nothing free-text or PII-shaped.
  for (const value of Object.values(event.properties)) {
    assert.ok(["string", "boolean", "number"].includes(typeof value));
  }
});

test("flush returns immediately when nothing is pending", async () => {
  const start = Date.now();
  await flushTelemetry(2000);
  assert.ok(Date.now() - start < 100);
});
