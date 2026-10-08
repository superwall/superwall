import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { CommandDefinition } from "@/command";
import { setupApple, type AppleSetupDeps } from "@/commands/platform/apple";
import { runSetup } from "@/commands/platform/setup";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import {
  AppleError,
  type AppleSession,
  type AppleTeam,
  type IrisRequest,
  type PendingVerification,
} from "@/core/apple/session";
import { run } from "../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const PEM = "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----\n";
const OURS = "https://integrations.superwall.com/integrations/app-store-connect/webhook?pk=pk_1";
const ACME: AppleTeam = { id: 111, issuerId: "issuer-111", name: "Acme Inc" };
const PENDING: PendingVerification = {
  appleId: "jane@example.com",
  serviceKey: "widget",
  sessionId: "session-1",
  scnt: "scnt-1",
  cookies: [],
};

afterEach(() => {
  process.exitCode = undefined;
});

interface AppleOptions {
  twoFactor?: boolean;
  apps?: Array<{ id: string; attributes: { name: string; bundleId: string } }>;
  teams?: AppleTeam[];
  refuse?: Partial<Record<"apiKeys" | "subscriptionKeys", AppleError>>;
}

function fakeSession(options: AppleOptions, log: string[]): AppleSession {
  const teams = options.teams ?? [ACME];
  let current = teams[0]!;
  return {
    signIn: async (appleId) => {
      log.push(`signIn ${appleId}`);
      return options.twoFactor ? "verification-required" : "signed-in";
    },
    requestCode: async (request = {}) => {
      log.push(`requestCode ${request.sms ? "sms" : "device"}`);
      return request.sms
        ? { method: "sms", destination: "•••42", codeLength: 6 }
        : { method: "device", codeLength: 6 };
    },
    submitCode: async (code) => {
      log.push(`submitCode ${code}`);
      if (code !== "123456") throw new AppleError("verification", "Incorrect verification code.");
    },
    pending: () => PENDING,
    team: () => current,
    teams: () => teams,
    selectTeam: async (id) => {
      log.push(`selectTeam ${id}`);
      current = teams.find((team) => team.id === id) ?? current;
    },
    iris: async (method: string, path: string, request?: IrisRequest) => {
      if (path === "/apps") {
        const apps = options.apps ?? [
          { id: "555", attributes: { name: "Acme", bundleId: "com.acme.app" } },
        ];
        const wanted = request?.query?.["filter[bundleId]"];
        return { data: wanted ? apps.filter((app) => app.attributes.bundleId === wanted) : apps };
      }
      log.push(`iris ${method} ${path}`);
      const resource = path.split("/")[1] as "apiKeys" | "subscriptionKeys";
      const refusal = options.refuse?.[resource];
      if (refusal && method === "POST") throw refusal;
      if (method === "POST") return { data: { id: resource === "apiKeys" ? "TEAMKEY001" : "IAPKEY0001" } };
      return { data: { attributes: { privateKey: PEM } } };
    },
  };
}

interface ApiOptions {
  projects?: unknown[];
  configs?: unknown[];
  existing?: Record<string, unknown>;
  appVerdicts?: Array<{ valid: boolean; error: string | null }>;
  purchaseVerdict?: { valid: boolean; error: string | null };
  failOrgSave?: ApiError;
  createdApps?: unknown[];
  failRead?: ApiError;
}

const IOS_APP = { id: 8, name: "Acme", platform: "ios", bundle_id: "com.acme.app" };

function fakeApi(options: ApiOptions = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const appVerdicts = [...(options.appVerdicts ?? [])];
  const handle = (method: string, path: string, body?: unknown): unknown => {
    requests.push({ method, path, ...(body === undefined ? {} : { body }) });
    if (path === "/v2/organizations/9/app-store-connect") {
      if (method === "GET") return { data: options.configs ?? [] };
      if (options.failOrgSave) throw options.failOrgSave;
      return { team_id: "TEAMID1234" };
    }
    if (path === "/v2/organizations/9/app-store-connect/TEAMID1234") return { team_id: "TEAMID1234" };
    if (path.endsWith("/integrations/app-store-connect/configuration")) {
      return appVerdicts.shift() ?? { valid: true, error: null };
    }
    if (path.endsWith("/integrations/in-app-purchase/configuration")) {
      return options.purchaseVerdict ?? { valid: true, error: null };
    }
    if (path.endsWith("/app-store-connect/notification-url")) return { url: OURS };
    if (path.includes("/proxy/TEAMID1234/v1/apps/")) {
      if (method === "GET") {
        if (options.failRead) throw options.failRead;
        return { data: { attributes: options.existing ?? {} } };
      }
      return {};
    }
    if (path === "/v2/projects") return { id: 70 };
    if (/^\/v2\/projects\/\d+\/applications$/.test(path)) {
      const projectId = Number(path.split("/")[3]);
      const sent = body as { name: string; bundle_id: string };
      return {
        id: projectId,
        applications: options.createdApps ?? [
          { id: 3, name: "Android", platform: "android", bundle_id: sent.bundle_id },
          { id: 99, name: sent.name, platform: "ios", bundle_id: sent.bundle_id },
        ],
      };
    }
    throw new Error(`unhandled ${method} ${path}`);
  };
  const api: Partial<SuperwallApi> = {
    org: { id: "9", name: "Org", count: 1 },
    list: async () => (options.projects ?? [{ id: 5, name: "Main", applications: [IOS_APP] }]) as never[],
    get: async (path) => handle("GET", path) as never,
    post: async (path, body) => handle("POST", path, body) as never,
    put: async (path, body) => handle("PUT", path, body) as never,
    patch: async (path, body) => handle("PATCH", path, body) as never,
  };
  return { api, requests };
}

interface Scenario {
  apple?: AppleOptions;
  api?: ApiOptions;
  argv?: Record<string, unknown>;
  credentials?: { appleId?: string; password?: string };
  stored?: PendingVerification;
  interactive?: boolean;
  answers?: { text?: Array<string | null>; select?: Array<string | null> };
}

async function scenario(options: Scenario = {}) {
  const log: string[] = [];
  const sleeps: number[] = [];
  const files: Record<string, string> = {};
  const sessions: Array<PendingVerification | undefined> = [];
  let stored = options.stored;
  const deps: AppleSetupDeps = {
    session: (sessionOptions) => {
      sessions.push(sessionOptions?.pending);
      return fakeSession(options.apple ?? {}, log);
    },
    pending: {
      load: () => stored,
      save: (pending) => {
        stored = pending;
      },
      clear: () => {
        stored = undefined;
      },
    },
    credentials: () => options.credentials ?? { appleId: "jane@example.com", password: "hunter2" },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    writeKeyFile: (name, privateKey) => {
      files[name] = privateKey;
      return `/tmp/${name}`;
    },
  };
  const { api, requests } = fakeApi(options.api);
  const calls: RendererCall[] = [];
  const text = [...(options.answers?.text ?? [])];
  const select = [...(options.answers?.select ?? [])];
  const renderer = {
    ...recordingRenderer(calls),
    text: async (value: unknown) => (calls.push({ method: "text", value }), text.shift() ?? null),
    select: async (value: unknown) => (calls.push({ method: "select", value }), select.shift() ?? null),
  };
  const definition: CommandDefinition<"required"> = {
    name: "setup",
    auth: "required",
    output: "both",
    run: (ctx) => setupApple(ctx, deps),
  };
  const result = await run(definition, {
    argv: { target: "apple", ...options.argv },
    api,
    interactive: options.interactive ?? false,
    renderer,
  });
  return {
    result,
    calls,
    log,
    sleeps,
    files,
    sessions,
    requests,
    pending: () => stored,
    said: (method: string) =>
      calls
        .filter((call) => call.method === method)
        .map((call) => String(call.value ?? "").replace(/\u001B\[[0-9;]*m/g, "")),
    wrote: (method: string, fragment: string) =>
      requests.filter((request) => request.method === method && request.path.includes(fragment)),
  };
}

test("connects an app end to end without prompts", async () => {
  const run = await scenario({ argv: { json: true } });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.result.json, {
    status: "ok",
    team: ACME,
    app: { id: "8", project_id: "5", name: "Acme", bundle_id: "com.acme.app", created: false },
    steps: {
      team_key: { status: "done", detail: "TEAMKEY001" },
      purchase_key: { status: "done", detail: "IAPKEY0001" },
      webhook: { status: "done", detail: "set" },
    },
    webhook_url: OURS,
    failed: [],
  });
  assert.deepEqual(run.log, [
    "signIn jane@example.com",
    "iris POST /apiKeys",
    "iris GET /apiKeys/TEAMKEY001",
    "iris POST /subscriptionKeys",
    "iris GET /subscriptionKeys/IAPKEY0001",
  ]);
  assert.deepEqual(run.wrote("POST", "/app-store-connect")[0]?.body, {
    key_id: "TEAMKEY001",
    issuer_id: "issuer-111",
    private_key: PEM,
    account_name: "Acme Inc",
  });
  assert.deepEqual(run.wrote("PUT", "/app-store-connect/configuration")[0]?.body, {
    key_id: "TEAMKEY001",
    issuer_id: "issuer-111",
    private_key: PEM,
  });
  assert.deepEqual(run.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.app",
    key_id: "IAPKEY0001",
    issuer_id: "issuer-111",
    private_key: PEM,
  });
  assert.equal(run.wrote("PATCH", "/v1/apps/555").length, 1);
  assert.deepEqual(run.files, {});
  assert.deepEqual(
    run.calls.map((call) => call.method),
    ["start", "stop"],
  );
});

test("human output ends with a report and a success line", async () => {
  const run = await scenario();
  assert.deepEqual(run.said("report"), [
    "✓ App Store Connect API key  TEAMKEY001\n✓ In-App Purchase key  IAPKEY0001\n✓ Server notification URL  set",
  ]);
  assert.deepEqual(run.said("success"), ["Apple is connected for `Acme`."]);
});

test("without prompts, stops for a verification code, then continues from the saved sign-in", async () => {
  const first = await scenario({ apple: { twoFactor: true }, argv: { json: true } });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(first.result.json, {
    status: "verification_required",
    method: "device",
    destination: null,
    next: "superwall setup apple --code <code>",
  });
  assert.deepEqual(first.pending(), PENDING);
  assert.deepEqual(first.log, ["signIn jane@example.com", "requestCode device"]);
  assert.equal(first.requests.some((request) => request.method !== "GET"), false);

  process.exitCode = undefined;
  const second = await scenario({
    apple: { twoFactor: true },
    argv: { json: true, code: "123456" },
    stored: first.pending(),
    credentials: {},
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(second.sessions, [PENDING]);
  assert.equal(second.log[0], "submitCode 123456");
  assert.equal(second.pending(), undefined);
  assert.equal((second.result.json as { status: string }).status, "ok");
});

test("a text message can be requested for a saved sign-in", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { sms: true },
    stored: PENDING,
    credentials: {},
  });
  assert.deepEqual(run.log, ["requestCode sms"]);
  assert.match(run.said("warn")[0] ?? "", /Apple texted a code to •••42\./);
  assert.match(run.said("warn")[0] ?? "", /with the same flags within 10 minutes/);
  assert.equal(process.exitCode, 1);
});

test("a wrong code without prompts keeps the sign-in so it can be retried", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { code: "000000" },
    stored: PENDING,
    credentials: {},
  });
  assert.equal(process.exitCode, 1);
  assert.match(run.said("error")[0] ?? "", /Apple didn't accept that code/);
  assert.deepEqual(run.pending(), PENDING);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
});

test("a code generated ahead of time works in a single run", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { json: true, code: "123456" },
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.log.slice(0, 3), [
    "signIn jane@example.com",
    "requestCode device",
    "submitCode 123456",
  ]);
  assert.equal((run.result.json as { status: string }).status, "ok");
});

test("a saved sign-in for another Apple Account is not reused", async () => {
  const run = await scenario({
    argv: { "apple-id": "other@example.com", code: "123456", json: true },
    stored: PENDING,
  });
  assert.deepEqual(run.sessions, [undefined]);
  assert.equal(run.log[0], "signIn other@example.com");
});

test("flags win over the environment for the Apple Account", async () => {
  const run = await scenario({
    argv: { "apple-id": "other@example.com", "apple-password": "from-flag", json: true },
    credentials: {},
  });
  assert.equal(run.log[0], "signIn other@example.com");
  assert.equal((run.result.json as { status: string }).status, "ok");
});

test("needs an email and password when it cannot prompt", async () => {
  const run = await scenario({ credentials: {} });
  assert.match(run.said("error")[0] ?? "", /Can't prompt for Apple sign-in here/);
  assert.match(run.said("error")[0] ?? "", /SUPERWALL_APPLE_PASSWORD/);
  assert.match(run.said("error")[0] ?? "", /If you are an agent, never ask for the password in chat/);
  assert.match(run.said("error")[0] ?? "", /Open it in the user's text editor/);
  assert.equal(run.log.length, 0);
});

test("prompts for the account, then the code, and can switch to a text", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { app: "8" },
    credentials: {},
    interactive: true,
    answers: { text: ["jane@example.com", "hunter2", "sms", "000000", "123456"] },
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.log.slice(0, 5), [
    "signIn jane@example.com",
    "requestCode device",
    "requestCode sms",
    "submitCode 000000",
    "submitCode 123456",
  ]);
  const prompts = run.calls
    .filter((call) => call.method === "text")
    .map((call) => call.value as { message: string; secret?: boolean });
  assert.deepEqual(
    prompts.map((prompt) => [prompt.message, prompt.secret === true]),
    [
      ["Apple Account email", false],
      ["Apple Account password", true],
      ["Verification code", false],
      ["Verification code", false],
      ["Verification code", false],
    ],
  );
  assert.match(run.said("warn")[0] ?? "", /didn't accept that code/);
});

test("gives up after three wrong codes at the prompt", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { app: "8" },
    interactive: true,
    answers: { text: ["1", "2", "3"] },
  });
  assert.equal(process.exitCode, 1);
  assert.equal(run.log.filter((line) => line.startsWith("submitCode")).length, 3);
});

test("cancelling a prompt stops before anything is created", async () => {
  for (const text of [[null], ["jane@example.com", null]]) {
    const run = await scenario({
      argv: { app: "8" },
      credentials: {},
      interactive: true,
      answers: { text },
    });
    assert.deepEqual(run.said("error"), ["Cancelled."]);
    assert.equal(run.log.length, 0);
  }
  const code = await scenario({
    apple: { twoFactor: true },
    argv: { app: "8" },
    interactive: true,
    answers: { text: [null] },
  });
  assert.deepEqual(code.said("error"), ["Cancelled."]);
});

test("refuses to replace a server notification URL that is already set", async () => {
  const theirs = "https://api.revenuecat.com/v1/incoming-webhooks/apple";
  const run = await scenario({ api: { existing: { subscriptionStatusUrl: theirs } } });
  assert.equal(process.exitCode, 1);
  assert.equal(run.wrote("PATCH", "/v1/apps/555").length, 0);
  assert.match(run.said("error")[0] ?? "", /already set on this app. Superwall won't replace it/);
  assert.match(run.said("error")[0] ?? "", new RegExp(`Production: ${theirs}`));
  assert.match(run.said("report")[0] ?? "", /✗ Server notification URL  not done/);
  assert.match(run.said("warn").at(-1) ?? "", /Partly done/);

  process.exitCode = undefined;
  const json = await scenario({
    api: { existing: { subscriptionStatusUrlForSandbox: theirs } },
    argv: { json: true },
  });
  const body = json.result.json as { status: string; failed: string[] };
  assert.equal(body.status, "partial");
  assert.deepEqual(body.failed, ["webhook"]);
});

test("leaves a URL that already points at Superwall alone", async () => {
  const run = await scenario({
    api: { existing: { subscriptionStatusUrl: OURS, subscriptionStatusUrlForSandbox: OURS } },
    argv: { json: true },
  });
  assert.equal(run.wrote("PATCH", "/v1/apps/555").length, 0);
  assert.deepEqual((run.result.json as { steps: { webhook: unknown } }).steps.webhook, {
    status: "done",
    detail: "already set",
  });
});

test("a refused In-App Purchase key leaves the rest done and exits non-zero", async () => {
  const run = await scenario({
    apple: { refuse: { subscriptionKeys: new AppleError("forbidden", "does not allow this request", 403) } },
    argv: { json: true },
  });
  assert.equal(process.exitCode, 1);
  const body = run.result.json as {
    failed: string[];
    steps: Record<string, { status: string; detail?: string }>;
  };
  assert.deepEqual(body.failed, ["purchase_key"]);
  assert.equal(body.steps.team_key?.status, "done");
  assert.equal(body.steps.webhook?.status, "done");
  assert.match(body.steps.purchase_key?.detail ?? "", /Admin or the Account Holder/);
});

test("a refused team key explains the limit or the role, and still tries the rest", async () => {
  const limit = await scenario({
    apple: { refuse: { apiKeys: new AppleError("request", "Maximum number of active keys", 409) } },
    argv: { json: true },
  });
  const body = limit.result.json as { steps: Record<string, { status: string; detail?: string }> };
  assert.match(body.steps.team_key?.detail ?? "", /limit of active keys/);
  assert.equal(body.steps.purchase_key?.status, "done");
  assert.match(body.steps.webhook?.detail ?? "", /No App Store Connect key is connected/);

  process.exitCode = undefined;
  const other = await scenario({
    apple: { refuse: { apiKeys: new AppleError("request", "Server busy", 500) } },
    api: { configs: [{ team_id: "TEAMID1234", issuer_id: "issuer-111" }] },
    argv: { json: true },
  });
  const otherBody = other.result.json as { steps: Record<string, { status: string; detail?: string }> };
  assert.equal(otherBody.steps.team_key?.detail, "Apple refused: Server busy");
  assert.equal(otherBody.steps.webhook?.status, "done");
});

test("waits for Apple to activate a new key, then keeps it on disk if it never does", async () => {
  const slow = await scenario({
    api: { appVerdicts: [{ valid: false, error: "401" }, { valid: false, error: "401" }] },
    argv: { json: true },
  });
  assert.deepEqual(slow.sleeps, [2000, 4000]);
  assert.equal((slow.result.json as { status: string }).status, "ok");

  process.exitCode = undefined;
  const never = await scenario({
    api: { purchaseVerdict: { valid: false, error: "Invalid key" } },
  });
  assert.equal(process.exitCode, 1);
  assert.equal(never.sleeps.length, 7);
  assert.deepEqual(never.files, { "SubscriptionKey_IAPKEY0001.p8": PEM });
  assert.match(never.said("warn")[0] ?? "", /saved to \/tmp\/SubscriptionKey_IAPKEY0001\.p8/);
});

test("retries the organization save while Apple still rejects the key", async () => {
  const run = await scenario({
    api: { failOrgSave: new ApiError("POST /x", 500, '{"message":"boom"}') },
    argv: { json: true },
  });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run.files, { "AuthKey_TEAMKEY001.p8": PEM });
  assert.deepEqual(run.sleeps, []);
  const body = run.result.json as { steps: Record<string, { status: string; detail?: string }> };
  assert.match(body.steps.team_key?.detail ?? "", /Superwall couldn't save the key: boom/);
});

test("rotates the organization's key when that team is already connected", async () => {
  const run = await scenario({
    api: { configs: [{ team_id: "TEAMID1234", issuer_id: "issuer-111" }] },
    argv: { json: true },
  });
  assert.equal(run.wrote("POST", "/app-store-connect").length, 0);
  assert.equal(run.wrote("PATCH", "/app-store-connect/TEAMID1234").length, 1);
});

test("a failed read of the notification URL is reported, not thrown", async () => {
  const run = await scenario({
    api: { failRead: new ApiError("GET /x", 409, '{"message":"not allowed"}') },
    argv: { json: true },
  });
  const body = run.result.json as { steps: Record<string, { detail?: string }> };
  assert.equal(body.steps.webhook?.detail, "App Store Connect refused: not allowed");
});

test("skip flags leave each step alone", async () => {
  const run = await scenario({
    api: { configs: [{ team_id: "TEAMID1234", issuer_id: "issuer-111" }] },
    argv: { json: true, "skip-team-key": true, "skip-purchase-key": true, "skip-webhook": true },
  });
  assert.deepEqual(run.log, ["signIn jane@example.com"]);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
  assert.deepEqual((run.result.json as { steps: unknown }).steps, {
    team_key: { status: "skipped" },
    purchase_key: { status: "skipped" },
    webhook: { status: "skipped" },
  });
});

test("picks the Apple team by flag, and asks for one when there are several", async () => {
  const teams = [ACME, { id: 222, issuerId: "issuer-222", name: "Side Project" }];
  const missing = await scenario({ apple: { teams } });
  assert.match(missing.said("error")[0] ?? "", /several teams: 111 \(Acme Inc\), 222 \(Side Project\)/);

  process.exitCode = undefined;
  const named = await scenario({ apple: { teams }, argv: { team: "side project", json: true } });
  assert.ok(named.log.includes("selectTeam 222"));
  assert.equal((named.result.json as { team: AppleTeam }).team.id, 222);

  process.exitCode = undefined;
  const unknown = await scenario({ apple: { teams }, argv: { team: "999" } });
  assert.match(unknown.said("error")[0] ?? "", /isn't on team 999/);

  process.exitCode = undefined;
  const picked = await scenario({
    apple: { teams },
    interactive: true,
    answers: { select: ["222"] },
    argv: { app: "8" },
  });
  assert.ok(picked.log.includes("selectTeam 222"));

  process.exitCode = undefined;
  const cancelled = await scenario({ apple: { teams }, interactive: true, argv: { app: "8" } });
  assert.deepEqual(cancelled.said("error"), ["Cancelled."]);
});

test("--dry-run signs in and checks key access without creating anything", async () => {
  const run = await scenario({
    apple: { refuse: {} },
    argv: { dryRun: true, json: true },
  });
  assert.deepEqual(run.result.json, { dryRun: true, team: ACME, access: { team: "ok", purchase: "ok" } });
  assert.deepEqual(run.log, ["signIn jane@example.com", "iris GET /apiKeys", "iris GET /subscriptionKeys"]);
  assert.equal(run.requests.length, 0);

  const human = await scenario({ argv: { dryRun: true } });
  assert.deepEqual(human.said("report"), ["✓ Team keys  ok\n✓ In-App Purchase keys  ok"]);
});

test("rejects an unknown key role before signing in", async () => {
  const run = await scenario({ argv: { "key-role": "finance" } });
  assert.deepEqual(run.said("error"), ["--key-role must be app_manager or admin."]);
  assert.equal(run.log.length, 0);
});

test("creates a Superwall app from the App Store Connect app when there is none", async () => {
  const run = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: [] }] },
    argv: { "bundle-id": "com.acme.app", json: true },
  });
  assert.deepEqual(run.wrote("POST", "/v2/projects/5/applications")[0]?.body, {
    name: "Acme",
    platform: "ios",
    bundle_id: "com.acme.app",
  });
  assert.deepEqual((run.result.json as { app: unknown }).app, {
    id: "99",
    project_id: "5",
    name: "Acme",
    bundle_id: "com.acme.app",
    created: true,
  });
});

test("a created app the API does not return stops before anything is created at Apple", async () => {
  const run = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: [] }], createdApps: [] },
    argv: { "bundle-id": "com.acme.app" },
  });
  assert.match(run.said("error")[0] ?? "", /Superwall created Acme but didn't return it/);
  assert.deepEqual(run.log, ["signIn jane@example.com"]);
});

test("creates the project too when the organization has none", async () => {
  const run = await scenario({ api: { projects: [] }, argv: { "bundle-id": "com.acme.app", json: true } });
  assert.deepEqual(run.wrote("POST", "/v2/projects")[0]?.body, { name: "Acme", organization_id: 9 });
  assert.equal((run.result.json as { app: { project_id: string } }).app.project_id, "70");
});

test("app choice errors name what to pass", async () => {
  const none = await scenario({ api: { projects: [{ id: 5, applications: [] }] } });
  assert.match(none.said("error")[0] ?? "", /Pass --bundle-id <id>/);
  assert.equal(none.log.length, 0);

  const several = await scenario({
    api: {
      projects: [
        { id: 5, applications: [IOS_APP, { id: 9, name: "Other", platform: "IOS", bundle_id: "com.acme.other" }] },
      ],
    },
  });
  assert.match(several.said("error")[0] ?? "", /Several iOS apps found: 8 \(Acme\), 9 \(Other\)\. Pass --app <id>/);

  const many = await scenario({
    api: {
      projects: [
        {
          id: 5,
          applications: Array.from({ length: 10 }, (_, index) => ({
            id: index + 1,
            name: `App ${index + 1}`,
            platform: "ios",
          })),
        },
      ],
    },
  });
  assert.match(
    many.said("error")[0] ?? "",
    /8 \(App 8\), and 2 more \(`superwall apps` lists them all\)\. Pass --app <id>/,
  );

  const unknownApp = await scenario({ argv: { app: "404" } });
  assert.deepEqual(unknownApp.said("error"), ["No iOS app 404 in this organization."]);

  const unknownProject = await scenario({ argv: { project: "404" } });
  assert.deepEqual(unknownProject.said("error"), ["No project 404 in this organization."]);
});

test("a bundle ID that is not on the signed-in team stops before anything is created", async () => {
  const apps = [
    { id: "701", attributes: { name: "Other", bundleId: "com.acme.other" } },
    { id: "702", attributes: { name: "Third", bundleId: "com.acme.third" } },
  ];
  for (const projects of [[{ id: 5, applications: [] }], undefined]) {
    const run = await scenario({
      apple: { apps },
      api: { projects },
      argv: projects ? { "bundle-id": "com.acme.app" } : {},
    });
    assert.equal(process.exitCode, 1);
    assert.match(
      run.said("error")[0] ?? "",
      /No App Store Connect app with bundle ID com\.acme\.app on the Apple team "Acme Inc"\. Nothing was created\./,
    );
    assert.match(run.said("error")[0] ?? "", /This team's apps: com\.acme\.other, com\.acme\.third\./);
    assert.deepEqual(run.log, ["signIn jane@example.com"]);
    assert.equal(run.requests.some((request) => request.method !== "GET"), false);
    assert.deepEqual(run.files, {});
  }

  const empty = await scenario({ apple: { apps: [] } });
  assert.match(empty.said("error")[0] ?? "", /This team has no apps yet\./);

  const none = await scenario({
    apple: { apps: [] },
    api: { projects: [{ id: 5, applications: [{ id: 8, name: "Acme", platform: "ios" }] }] },
  });
  assert.match(none.said("error")[0] ?? "", /has no apps in App Store Connect yet/);
});

test("interactively picks an existing app, or creates one from an App Store Connect app", async () => {
  const apps = [IOS_APP, { id: 9, name: "Other", platform: "ios", bundle_id: "com.acme.other" }];
  const existing = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: apps }] },
    interactive: true,
    answers: { select: ["8"] },
  });
  assert.deepEqual(existing.said("success"), ["Apple is connected for `Acme`."]);

  const created = await scenario({
    api: {
      projects: [
        { id: 5, name: "Main", applications: apps },
        { id: 6, name: "Second", applications: [] },
      ],
    },
    interactive: true,
    answers: { select: ["__new__", "555", "6"] },
  });
  assert.equal(created.wrote("POST", "/v2/projects/6/applications").length, 1);

  const cancelled = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: apps }] },
    interactive: true,
  });
  assert.deepEqual(cancelled.said("error"), ["Cancelled."]);
});

test("an app without a bundle id takes it from the flag or from App Store Connect", async () => {
  const bare = { id: 8, name: "Acme", platform: "ios" };
  const flagged = await scenario({
    api: { projects: [{ id: 5, applications: [bare] }] },
    argv: { app: "8", "bundle-id": "com.acme.app", json: true },
  });
  assert.equal((flagged.result.json as { app: { bundle_id: string } }).app.bundle_id, "com.acme.app");

  const picked = await scenario({
    api: { projects: [{ id: 5, applications: [bare] }] },
    interactive: true,
    answers: { select: ["8", "555"] },
  });
  assert.deepEqual(picked.said("success"), ["Apple is connected for `Acme`."]);

  const unknown = await scenario({ api: { projects: [{ id: 5, applications: [bare] }] } });
  assert.match(unknown.said("error")[0] ?? "", /Pass --bundle-id <id>\. This team's apps: com\.acme\.app/);
});

test("--bundle-id wins over the bundle ID Superwall has for the chosen app, with a warning", async () => {
  const run = await scenario({
    apple: { apps: [{ id: "777", attributes: { name: "Other", bundleId: "com.acme.other" } }] },
    argv: { app: "8", "bundle-id": "com.acme.other" },
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.said("warn"), [
    "Superwall has bundle ID com.acme.app for Acme; using com.acme.other from --bundle-id for Apple.",
  ]);
  assert.deepEqual(run.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.other",
    key_id: "IAPKEY0001",
    issuer_id: "issuer-111",
    private_key: PEM,
  });
});

test("setup only knows apple", async () => {
  const result = await run(runSetup.definition, { argv: { target: "google" }, api: {} });
  assert.deepEqual(result.said("error"), ['Unknown "setup google". Use: setup apple']);
});
