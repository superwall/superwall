import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFeedbackEvent,
  organizationOfApp,
  detectAgent,
  MAX_FILE_CHARS,
  parseContext,
  readAttachments,
} from "@/core/feedback";
import type { SuperwallApi } from "@/core/api/client";

test("feedback event carries the report, source, and follow-up contact", () => {
  const event = buildFeedbackEvent(
    {
      title: "migrate crash",
      message: "migrate crashed on Expo",
      kind: "bug",
      command: "superwall migrate",
      agent: "claude-code",
      projectId: "7",
      applicationId: "123",
      context: { paywall: "pw_abc", sdk: "expo@3.1.0" },
      attachments: [{ name: "log.txt", content: "boom", truncated: false }],
    },
    "agent",
    "3e37f5f0-0000-4000-8000-000000000000",
    { userEmail: "dev@acme.com", orgName: "Acme" },
  ) as {
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  };

  assert.equal(event.event, "feedback submitted");
  assert.equal(event.distinct_id, "3e37f5f0-0000-4000-8000-000000000000");
  assert.equal(event.properties.title, "migrate crash");
  assert.equal(event.properties.message, "migrate crashed on Expo");
  assert.equal(event.properties.kind, "bug");
  assert.equal(event.properties.command, "superwall migrate");
  assert.equal(event.properties.agent, "claude-code");
  assert.equal(event.properties.project_id, "7");
  assert.equal(event.properties.application_id, "123");
  assert.deepEqual(event.properties.context, {
    paywall: "pw_abc",
    sdk: "expo@3.1.0",
  });
  assert.equal(typeof event.properties.os_release, "string");
  assert.deepEqual(event.properties.attachments, [
    { name: "log.txt", content: "boom", truncated: false },
  ]);
  assert.equal(event.properties.via, "agent");
  assert.equal(event.properties.email, "dev@acme.com");
  assert.equal(event.properties.org_name, "Acme");
  assert.equal(typeof event.properties.cli_version, "string");
});

test("feedback event is contact-free when logged out", () => {
  const event = buildFeedbackEvent(
    { message: "nice tool", kind: "praise", context: {}, attachments: [] },
    "human",
    "anon-id",
    null,
  ) as { properties: Record<string, unknown> };
  assert.equal(event.properties.email, null);
  assert.equal(event.properties.org_id, undefined);
  assert.equal(event.properties.title, null);
  assert.equal(event.properties.application_id, null);
  assert.equal(event.properties.via, "human");
});

test("attachments keep the base name and the tail of long files", () => {
  const dir = mkdtempSync(join(tmpdir(), "sw-feedback-"));
  const path = join(dir, "push.log");
  writeFileSync(path, `${"x".repeat(MAX_FILE_CHARS)}END`);
  const file = readAttachments([path])[0]!;
  assert.equal(file.name, "push.log");
  assert.equal(file.truncated, true);
  assert.equal(file.content.length, MAX_FILE_CHARS);
  assert.ok(file.content.endsWith("END"));
});

test("attachments are capped", () => {
  assert.throws(() => readAttachments(Array(6).fill("a.txt")), /at most 5/);
});

test("agent is detected from its env marker", () => {
  assert.equal(detectAgent({ CLAUDECODE: "1" }), "claude-code");
  assert.equal(detectAgent({}), undefined);
});

test("context pairs parse, keeping '=' inside values", () => {
  assert.deepEqual(parseContext(["paywall=pw_1", "url=a?b=c"]), {
    paywall: "pw_1",
    url: "a?b=c",
  });
  assert.throws(() => parseContext(["paywall"]), /key=value/);
});

test("feedback names the organization of the app it's about", () => {
  const event = buildFeedbackEvent(
    {
      message: "m",
      kind: "bug",
      applicationId: "1022",
      organizationId: "1",
      context: {},
      attachments: [],
    },
    "agent",
    "anon",
    null,
  ) as { properties: Record<string, unknown> };
  assert.equal(event.properties.organization_id, "1");
});

test("the app's organization is looked up from the app, and never blocks a report", async () => {
  const api = (get: (path: string) => Promise<unknown>) =>
    ({
      list: async () => [{ id: 887, organization_id: 1, applications: [{ id: "1022" }] }],
      get,
    }) as unknown as SuperwallApi;
  assert.equal(
    await organizationOfApp(
      api(async () => ({})),
      "1022",
    ),
    "1",
  );
  assert.equal(await organizationOfApp(undefined, "1022"), undefined);
  assert.equal(
    await organizationOfApp(
      api(async () => ({})),
      undefined,
    ),
    undefined,
  );
  const broken = {
    list: async () => Promise.reject(new Error("offline")),
  } as unknown as SuperwallApi;
  assert.equal(await organizationOfApp(broken, "1022"), undefined);
});
