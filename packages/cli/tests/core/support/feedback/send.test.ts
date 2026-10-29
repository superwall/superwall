import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFeedbackEvent,
  organizationOfApp,
  MAX_FILE_CHARS,
  parseContext,
  readAttachments,
  runFeedback,
} from "@/core/support/feedback/send";
import type { SuperwallApi } from "@/core/api/client";
import { writeOnboardedApp } from "@/core/state/config";
import { command as feedback } from "@/commands/support/feedback";
import { defineCommand } from "@/program/command";
import type { Renderer } from "@/ui";
import { runCommand } from "../../../helpers/command";
import { restoreFetch, useFetch } from "../../../helpers/fetch";
import { clearHomes, useHome } from "../../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

const AGENT_MARKERS = ["CLAUDECODE", "CODEX_SANDBOX", "CURSOR_AGENT", "GEMINI_CLI"];
const markers = Object.fromEntries(AGENT_MARKERS.map((key) => [key, process.env[key]]));

afterEach(() => {
  restoreFetch();
  clearHomes();
  mock.timers.reset();
  for (const [key, value] of Object.entries(markers)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.exitCode = undefined;
});

function withoutAgentMarkers(): void {
  for (const key of AGENT_MARKERS) delete process.env[key];
}

function sentProperties(log: { body?: string }[]): Record<string, unknown> {
  return (JSON.parse(String(log[0]?.body)) as { properties: Record<string, unknown> }).properties;
}

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
    "25.0.0",
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
  assert.equal(event.properties.os_release, "25.0.0");
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

test("someone typing at a prompt sends as a human, and the prompt requires an answer", async () => {
  useHome();
  withoutAgentMarkers();
  const log = useFetch([{ match: "/capture/", body: {} }]);
  const calls: RendererCall[] = [];
  const checks: (string | undefined)[] = [];
  const renderer = {
    ...recordingRenderer(calls),
    text: async (options: Parameters<Renderer["text"]>[0]) => {
      checks.push(options.validate?.("   "), options.validate?.("ok"));
      return " typed ";
    },
  };
  await runCommand(feedback, { interactive: true, renderer });
  assert.deepEqual(checks, ["Required", undefined]);
  assert.equal(sentProperties(log).via, "human");
  assert.equal(sentProperties(log).message, "typed");
  assert.deepEqual(
    calls.filter((call) => call.method.startsWith("spinner.")).map((call) => [call.method, call.value]),
    [
      ["spinner.start", "Sending your feedback"],
      ["spinner.stop", "Sent"],
    ],
  );
});

test("a report from a linked folder carries its app, project and organization", async () => {
  useHome();
  writeOnboardedApp(process.cwd(), { publicApiKey: "pk_x", projectId: "887", applicationId: "1022" });
  const log = useFetch([{ match: "/capture/", body: {} }]);
  const api = {
    list: async () => [{ id: 887, organization_id: 1, applications: [{ id: "1022" }] }],
  } as unknown as SuperwallApi;
  await runCommand(feedback, { args: { message: "hi" }, flags: { file: [""] }, json: true, api });
  const properties = sentProperties(log);
  assert.equal(properties.project_id, "887");
  assert.equal(properties.application_id, "1022");
  assert.equal(properties.organization_id, "1");
  assert.deepEqual(properties.attachments, []);
});

test("a send that can't reach the server reports it wasn't submitted", async () => {
  useHome();
  useFetch([{ match: "/capture/", fail: true }]);
  const result = await runCommand(feedback, { args: { message: "offline" }, json: true });
  assert.deepEqual(result.json, { submitted: false });
});

test("an unknown kind is refused before anything is sent", async () => {
  useHome();
  const log = useFetch([{ match: "/capture/", body: {} }]);
  const probe = defineCommand({
    name: "feedback",
    summary: "Feedback probe",
    examples: [["feedback", "Probe"]],
    auth: "optional",
    json: true,
    prompts: false,
    mcp: "read",
    run(ctx) {
      return runFeedback(ctx, {
        args: { message: "m" },
        flags: { title: undefined, kind: "rant", command: undefined, app: undefined, project: undefined, context: [], file: [], agent: undefined },
      });
    },
  });
  const result = await runCommand(probe, { json: true });
  assert.equal(
    (result.json as { error: { message: string } }).error.message,
    "--kind must be one of: bug, docs, idea, praise, other",
  );
  assert.equal(log.length, 0);
});

test("the organization lookup gives up after three seconds, and on an app it can't find", async () => {
  const unknown = { list: async () => [{ id: 887, applications: [] }] } as unknown as SuperwallApi;
  assert.equal(await organizationOfApp(unknown, "no-such-app"), undefined);

  mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = { list: () => new Promise(() => undefined) } as unknown as SuperwallApi;
  const pending = organizationOfApp(stalled, "1022");
  mock.timers.tick(3000);
  assert.equal(await pending, undefined);
});
