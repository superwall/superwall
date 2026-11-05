import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFeedbackBody,
  buildFeedbackEvent,
  formatFeedbackReport,
  MAX_FILE_CHARS,
  parseContext,
  parseFeedbackReport,
  readAttachments,
  resolveFeedbackTarget,
  runFeedback,
} from "@/core/support/feedback/send";
import { ApiError, type SuperwallApi } from "@/core/api/client";
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

test("a report from a linked folder carries its app and project", async () => {
  useHome();
  writeOnboardedApp(process.cwd(), { publicApiKey: "pk_x", projectId: "887", applicationId: "1022" });
  const log = useFetch([{ match: "/capture/", body: {} }]);
  await runCommand(feedback, { args: { message: "hi" }, flags: { file: [""] }, json: true });
  const properties = sentProperties(log);
  assert.equal(properties.project_id, "887");
  assert.equal(properties.application_id, "1022");
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
        flags: { title: undefined, kind: "rant", useCase: undefined, command: undefined, app: undefined, project: undefined, context: [], file: [], agent: undefined },
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

const project = { id: 887, organization_id: 1, applications: [{ id: 1022, name: "Acme iOS" }] };

function lookupApi(overrides: Partial<SuperwallApi> = {}): SuperwallApi {
  return {
    list: async () => [project],
    get: async () => project,
    ...overrides,
  } as unknown as SuperwallApi;
}

test("the app it's about is an id, a dashboard link or a name, resolved to its numeric id", async () => {
  const api = lookupApi();
  assert.deepEqual(await resolveFeedbackTarget(api, { app: "1022" }), { applicationId: "1022", projectId: undefined });
  assert.deepEqual(await resolveFeedbackTarget(api, { app: "https://superwall.com/9/1022/campaigns" }), {
    applicationId: "1022",
    organizationId: "9",
    projectId: undefined,
  });
  assert.deepEqual(await resolveFeedbackTarget(api, { app: "Acme iOS" }), {
    applicationId: "1022",
    projectId: "887",
    organizationId: "1",
  });
  await assert.rejects(resolveFeedbackTarget(api, { app: "Nope" }), /No app Nope that this account can open/);
});

test("an app name that can't be looked up is still sent, as typed", async () => {
  const offline = lookupApi({ list: async () => Promise.reject(new Error("offline")) });
  assert.deepEqual(await resolveFeedbackTarget(offline, { app: "Acme iOS" }), { applicationId: "Acme iOS", projectId: undefined });
  assert.deepEqual(await resolveFeedbackTarget(undefined, { app: "Acme iOS" }), { applicationId: "Acme iOS", projectId: undefined });
});

test("a project names its organization when it can be found", async () => {
  assert.deepEqual(await resolveFeedbackTarget(lookupApi(), { project: "887" }), { projectId: "887", organizationId: "1" });
  const broken = lookupApi({ list: async () => [], get: async () => Promise.reject(new Error("offline")) });
  assert.deepEqual(await resolveFeedbackTarget(broken, { project: "887" }), { projectId: "887", organizationId: undefined });
  assert.deepEqual(await resolveFeedbackTarget(undefined, { project: "887" }), { projectId: "887", organizationId: undefined });
});

test("the request body sends numeric ids, the organization only without an app, and the project as context", () => {
  const base = { message: "m", kind: "idea" as const, context: { sdk: "ios@4.5.0" }, attachments: [] };
  const withApp = buildFeedbackBody({ ...base, useCase: "ends a sale at midnight", applicationId: "1022", organizationId: "1", projectId: "887" }, "agent");
  assert.equal(withApp.application_id, 1022);
  assert.equal(withApp.organization_id, undefined);
  assert.equal(withApp.use_case, "ends a sale at midnight");
  assert.deepEqual(withApp.context, { project: "887", sdk: "ios@4.5.0" });
  assert.equal(withApp.via, "agent");
  assert.equal(typeof withApp.cli_version, "string");

  const orgOnly = buildFeedbackBody({ ...base, applicationId: "Acme iOS", organizationId: "1" }, "human");
  assert.equal(orgOnly.application_id, undefined);
  assert.equal(orgOnly.organization_id, 1);
  assert.deepEqual(orgOnly.context, { sdk: "ios@4.5.0" });
});

test("a server answer is read once, and anything else isn't a report", () => {
  assert.equal(parseFeedbackReport({ id: 1, outcome: "queued", request: {} }), undefined);
  assert.equal(parseFeedbackReport({ id: "1", outcome: "created", request: {} }), undefined);
  assert.equal(parseFeedbackReport(undefined), undefined);
  assert.deepEqual(parseFeedbackReport({ id: 4, outcome: "created", request: {} }), {
    object: "feedback_report",
    id: 4,
    outcome: "created",
    request: { id: 0, title: "", kind: "other", status: "open", report_count: 0, organization_count: 0 },
  });
});

test("a merged report names the request and how many teams asked", () => {
  const report = (outcome: "created" | "merged", reports: number, teams: number) => ({
    object: "feedback_report" as const,
    id: 1,
    outcome,
    request: { id: 2, title: "Webhooks retry policy", kind: "idea", status: "open", report_count: reports, organization_count: teams },
  });
  assert.equal(formatFeedbackReport(report("merged", 14, 9)), "Merged into 'Webhooks retry policy' (14 reports from 9 teams)");
  assert.equal(formatFeedbackReport(report("merged", 1, 1)), "Merged into 'Webhooks retry policy' (1 report from 1 team)");
  assert.equal(formatFeedbackReport(report("created", 1, 1)), "Opened a new request: 'Webhooks retry policy'");
});

const merged = {
  object: "feedback_report",
  id: 31,
  outcome: "merged",
  request: { id: 7, title: "Webhooks retry policy", kind: "idea", status: "planned", report_count: 14, organization_count: 9 },
};

test("signed in, a report goes to the feedback endpoint and answers with the request it joined", async () => {
  useHome();
  const log = useFetch([{ match: "/capture/", body: {} }]);
  const posts: { path: string; body: unknown }[] = [];
  const api = lookupApi({
    post: async <T>(path: string, body: unknown) => {
      posts.push({ path, body });
      return merged as T;
    },
  });
  const result = await runCommand(feedback, {
    args: { message: "webhooks never retry" },
    flags: { kind: "idea", useCase: "keeps entitlements in sync with their backend", app: "Acme iOS", agent: "codex" },
    json: true,
    api,
  });
  assert.deepEqual(result.json, merged);
  assert.equal(log.length, 0);
  assert.equal(posts[0]?.path, "/v2/feedback");
  const body = posts[0]?.body as Record<string, unknown>;
  assert.equal(body.kind, "idea");
  assert.equal(body.application_id, 1022);
  assert.equal(body.use_case, "keeps entitlements in sync with their backend");
  assert.equal(body.agent, "codex");

  const human = await runCommand(feedback, { args: { message: "again" }, api });
  assert.deepEqual(human.said("success"), ["Merged into 'Webhooks retry policy' (14 reports from 9 teams)"]);
});

test("when the endpoint isn't there or fails, the report goes to the team the old way", async () => {
  for (const failure of [new ApiError("POST /v2/feedback", 404, "{}"), new ApiError("POST /v2/feedback", 503), new Error("offline")]) {
    useHome();
    const log = useFetch([{ match: "/capture/", body: {} }]);
    const api = lookupApi({ post: async () => Promise.reject(failure) });
    const result = await runCommand(feedback, { args: { message: "m" }, flags: { useCase: "why" }, json: true, api });
    assert.deepEqual(result.json, { submitted: true, outcome: "queued" });
    assert.equal(sentProperties(log).use_case, "why");
  }
});

test("an answer the CLI can't read also falls back, so nothing is lost", async () => {
  useHome();
  const log = useFetch([{ match: "/capture/", body: {} }]);
  const api = lookupApi({ post: async <T>() => ({ ok: true }) as T });
  const result = await runCommand(feedback, { args: { message: "m" }, api });
  assert.equal(log.length, 1);
  assert.match(result.said("success").join(), /Thank you/);
});

test("an organization over its daily limit is told so, and nothing else is sent", async () => {
  useHome();
  const log = useFetch([{ match: "/capture/", body: {} }]);
  const api = lookupApi({
    post: async () => Promise.reject(new ApiError("POST /v2/feedback", 429, JSON.stringify({ message: "Too many feedback reports today" }))),
  });
  const result = await runCommand(feedback, { args: { message: "m" }, json: true, api });
  assert.equal(log.length, 0);
  assert.match(JSON.stringify(result.json), /Too many feedback reports today/);
});
