import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildEvent,
  flushTelemetry,
  isTelemetryEnabled,
  maybeShowTelemetryNotice,
  track,
  updateTelemetryTags,
} from "@/core/support/telemetry";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

const KEY = "phc_test";
const ENV_KEYS = [
  "NODE_TEST_CONTEXT",
  "DO_NOT_TRACK",
  "SUPERWALL_TELEMETRY_DISABLED",
  "SUPERWALL_TELEMETRY_HOST",
  "SUPERWALL_TELEMETRY_KEY",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function enableTelemetry(): void {
  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.DO_NOT_TRACK;
  delete process.env.SUPERWALL_TELEMETRY_DISABLED;
  process.env.SUPERWALL_TELEMETRY_HOST = "https://telemetry.test";
  process.env.SUPERWALL_TELEMETRY_KEY = KEY;
}

function noticeRecorder(): { info(message: string): void; said: string[] } {
  const said: string[] = [];
  return { said, info: (message) => said.push(message) };
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  restoreFetch();
  clearHomes();
});

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

test("flush returns immediately when nothing is pending", async () => {
  const start = Date.now();
  await flushTelemetry(2000);
  assert.ok(Date.now() - start < 100);
});

test("events are anonymous: uuid distinct_id, enum props, no person profile", () => {
  updateTelemetryTags({ framework: "expo", driver: "claude" });
  const event = buildEvent(
    "command finished",
    { command: "integrate", status: "success", duration_ms: 1200 },
    "3e37f5f0-0000-4000-8000-000000000000",
  ) as {
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  };

  assert.equal(event.event, "command finished");
  assert.equal(event.distinct_id, "3e37f5f0-0000-4000-8000-000000000000");
  assert.equal(event.properties.$process_person_profile, false);
  assert.equal(event.properties.framework, "expo");
  assert.equal(event.properties.driver, "claude");
  assert.equal(event.properties.status, "success");
  assert.equal(typeof event.properties.cli_version, "string");
  assert.equal(typeof event.properties.ci, "boolean");
  assert.equal(typeof event.properties.interactive, "boolean");
  for (const value of Object.values(event.properties)) {
    assert.ok(["string", "boolean", "number"].includes(typeof value));
  }
});

test("nothing is sent while telemetry is disabled", async () => {
  useHome();
  const log = useFetch([{ match: "telemetry.test" }]);

  track("command finished", { command: "login" });
  await flushTelemetry(100);

  assert.equal(log.length, 0);
});

test("an event is posted to the capture endpoint under one persisted anonymous id", async () => {
  const home = useHome();
  enableTelemetry();
  const log = useFetch([{ match: "telemetry.test/capture/" }]);

  track("command finished", { command: "login", duration_ms: 5 });
  track("command started");
  await flushTelemetry(1000);

  assert.equal(log.length, 2);
  assert.equal(log[0]!.url, "https://telemetry.test/capture/");
  assert.equal(log[0]!.method, "POST");
  const first = JSON.parse(log[0]!.body!) as {
    api_key: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  };
  const second = JSON.parse(log[1]!.body!) as { distinct_id: string; event: string };
  assert.equal(first.api_key, KEY);
  assert.equal(first.properties.command, "login");
  assert.equal(first.properties.duration_ms, 5);
  assert.equal(second.event, "command started");
  assert.equal(second.distinct_id, first.distinct_id);
  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as {
    telemetry: { anonymousId: string };
  };
  assert.equal(config.telemetry.anonymousId, first.distinct_id);
});

test("an unreachable endpoint never throws and the flush still settles", async () => {
  useHome();
  enableTelemetry();
  const log = useFetch([{ match: "telemetry.test", fail: true }]);

  track("command finished");
  await flushTelemetry(1000);

  assert.equal(log.length, 1);
});

test("a home that can't be written drops the event instead of failing the command", async () => {
  const home = useHome();
  const blocked = path.join(home, "not-a-dir");
  fs.writeFileSync(blocked, "");
  process.env.SUPERWALL_HOME = blocked;
  enableTelemetry();
  const log = useFetch([{ match: "telemetry.test" }]);

  assert.doesNotThrow(() => track("command finished"));
  await flushTelemetry(100);

  assert.equal(log.length, 0);
});

test("the opt-out notice is shown once, and never while telemetry is disabled", () => {
  useHome();
  const disabled = noticeRecorder();
  maybeShowTelemetryNotice(disabled);
  assert.deepEqual(disabled.said, []);

  enableTelemetry();
  const first = noticeRecorder();
  maybeShowTelemetryNotice(first);
  const second = noticeRecorder();
  maybeShowTelemetryNotice(second);

  assert.equal(first.said.length, 1);
  assert.match(first.said[0]!, /SUPERWALL_TELEMETRY_DISABLED=1/);
  assert.deepEqual(second.said, []);
});

test("a hanging endpoint can't hold the flush past its cap", async () => {
  useHome();
  enableTelemetry();
  globalThis.fetch = (() =>
    new Promise<Response>((done) => setTimeout(() => done(new Response("{}")), 800))) as typeof fetch;

  track("command finished");
  const start = Date.now();
  await flushTelemetry(50);

  assert.ok(Date.now() - start < 500);
});
