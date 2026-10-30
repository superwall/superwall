import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { afterEach, mock, test } from "node:test";
import { SKILLS_REF } from "@/core/support/skills";
import { openBrowser } from "@/core/account/browser";
import { performLogin, runLogin } from "@/core/account/login";
import { readSession } from "@/core/account/storage";
import {
  readOnboardedApp,
  readOnboardedOrg,
  readOnboardingIdempotencyKey,
  writeOnboardedOrg,
  writeSkillsSync,
} from "@/core/state/config";
import { VERSION } from "@/environment";
import type { CommandContext } from "@/program/command";
import { createCommandOutput } from "@/program/output";
import { useRenderer, type Renderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { clearHomes, useHome } from "../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const realFetch = globalThis.fetch;
const dirs: string[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
  clearHomes();
  selectRenderer({ mode: "text" });
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SUPERWALL_AUTH_HOST;
  delete process.env.SUPERWALL_API_HOST;
  delete process.env.SUPERWALL_CLI_CLIENT_ID;
});

type Reply = { status?: number; body?: unknown; text?: string; fail?: boolean; broken?: boolean };
type Sent = { url: string; method: string; body?: string; authorization?: string };

function serve(routes: Record<string, Reply | Reply[]>): Sent[] {
  const sent: Sent[] = [];
  const queues = new Map(
    Object.entries(routes).map(([suffix, reply]) => [suffix, Array.isArray(reply) ? [...reply] : reply]),
  );
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    sent.push({
      url,
      method: init?.method ?? "GET",
      ...(init?.body === undefined ? {} : { body: String(init.body) }),
      ...(headers.has("authorization") ? { authorization: headers.get("authorization") ?? "" } : {}),
    });
    const suffix = [...queues.keys()].find((key) => url.endsWith(key));
    const entry = suffix === undefined ? undefined : queues.get(suffix);
    const reply = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (!reply) throw new Error(`unexpected ${url}`);
    if (reply.fail) throw new Error(`offline: ${url}`);
    if (reply.broken) {
      const body = new ReadableStream({ start: (controller) => controller.error(new Error("reset")) });
      return new Response(body, { status: reply.status ?? 200 });
    }
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return sent;
}

const DISCOVERY = {
  "/.well-known/openid-configuration": {
    body: {
      token_endpoint: "https://auth.test/oauth2/token",
      device_authorization_endpoint: "https://auth.test/oauth2/device_authorization",
    },
  },
};

const DEVICE = {
  "/oauth2/device_authorization": {
    body: {
      device_code: "device-1",
      user_code: "ABCD-EFGH",
      verification_uri: "https://auth.test/device",
      interval: 0,
      expires_in: 300,
    },
  },
};

const ORGS = { "/v2/me/organizations": { body: { data: [{ id: 7, name: "Acme" }] } } };
const NO_ORGS = { "/v2/me/organizations": { body: { data: [] } } };
const ME = { "/v2/me": { body: { email: "new@example.com" } } };

const login = (options: Parameters<typeof performLogin>[0] = {}) =>
  performLogin({
    issuer: "https://auth.test",
    apiHost: "https://api.test",
    clientId: "client_test",
    openBrowser: async () => true,
    ...options,
  });

const formOf = (sent: Sent | undefined) => Object.fromEntries(new URLSearchParams(sent?.body));
const jsonOf = (sent: Sent | undefined): unknown => JSON.parse(sent?.body ?? "null");

test("a browser that can't be opened leaves the login polling until it is approved", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    "/oauth2/device_authorization": {
      body: {
        device_code: "device-1",
        user_code: "ABCD-EFGH",
        verification_uri: "https://auth.test/device",
        verification_uri_complete: "https://auth.test/device?user_code=ABCD-EFGH",
        interval: 0,
        expires_in: 300,
      },
    },
    "/oauth2/token": [
      { status: 400, body: { error: "authorization_pending" } },
      { status: 400, body: { error: "authorization_pending" } },
      { body: { access_token: "token-1", expires_in: 300 } },
    ],
    ...ME,
    ...ORGS,
  });

  const verified: Array<{ url: string; userCode: string; browserOpened: boolean }> = [];
  const statuses: string[] = [];
  const session = await login({
    openBrowser: (url) =>
      openBrowser(url, {
        platform: "linux",
        env: { DISPLAY: ":0" },
        spawn: ((_cmd: string, args: string[], options: object) =>
          spawn("superwall-test-no-such-browser", args, options)) as typeof spawn,
      }),
    onVerify: (info) => verified.push(info),
    onStatus: (message) => statuses.push(message),
  });

  assert.deepEqual(verified, [
    {
      url: "https://auth.test/device?user_code=ABCD-EFGH",
      userCode: "ABCD-EFGH",
      browserOpened: false,
    },
  ]);
  assert.equal(sent.filter((request) => request.url.endsWith("/oauth2/token")).length, 3);
  assert.deepEqual(statuses, [
    "Waiting for you to approve in the browser…",
    "Waiting for you to approve in the browser…",
  ]);
  assert.equal(session.accessToken, "token-1");
  assert.equal(session.userEmail, "new@example.com");
});

test("an approved login asks for the device code and keeps the whole OAuth session", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": {
      body: { access_token: "at_1", refresh_token: "rt_1", expires_in: 600, id_token: "id_1" },
    },
    ...ORGS,
    ...ME,
  });
  const verified: string[] = [];

  const session = await login({ onVerify: ({ url }) => verified.push(url) });

  assert.deepEqual(verified, ["https://auth.test/device"]);
  assert.deepEqual(formOf(sent[1]), {
    client_id: "client_test",
    scope: "openid profile email offline_access",
  });
  assert.deepEqual(formOf(sent[2]), {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: "device-1",
    client_id: "client_test",
  });
  assert.deepEqual(
    sent.slice(3).map((request) => `${request.method} ${request.url} ${request.authorization}`),
    [
      "GET https://api.test/v2/me Bearer id_1",
      "GET https://api.test/v2/me Bearer at_1",
      "GET https://api.test/v2/me/organizations Bearer at_1",
    ],
  );
  assert.equal(session.authMethod, "oauth");
  assert.equal(session.refreshToken, "rt_1");
  assert.equal(session.tokenEndpoint, "https://auth.test/oauth2/token");
  assert.equal(session.oauthClientId, "client_test");
  assert.ok((session.accessTokenExpiresAt ?? 0) > Date.now() + 590_000);
  assert.deepEqual(readSession(), session);
});

test("the issuer, API host and client id default to the environment", async () => {
  useHome();
  process.env.SUPERWALL_AUTH_HOST = "https://auth.env.test";
  process.env.SUPERWALL_API_HOST = "https://api.env.test";
  process.env.SUPERWALL_CLI_CLIENT_ID = "client_env";
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1" } },
    ...ORGS,
    "/v2/me": { status: 500 },
  });

  const session = await performLogin({ openBrowser: async () => true });

  assert.equal(sent[0]?.url, "https://auth.env.test/.well-known/openid-configuration");
  assert.equal(formOf(sent[1]).client_id, "client_env");
  assert.equal(session.host, "https://api.env.test");
  assert.equal(session.userEmail, undefined);
  assert.equal(session.accessTokenExpiresAt, undefined);
});

test("an issuer that can't be discovered, or offers no device flow, stops the login", async () => {
  useHome();
  serve({ "/.well-known/openid-configuration": { status: 503 } });
  await assert.rejects(login(), /OIDC discovery failed \(HTTP 503\)/);

  serve({ "/.well-known/openid-configuration": { body: { token_endpoint: "https://auth.test/t" } } });
  await assert.rejects(login(), /does not advertise a device-authorization endpoint/);
});

test("a refused device authorization whose body breaks off still reports the status", async () => {
  useHome();
  serve({ ...DISCOVERY, "/oauth2/device_authorization": { status: 500, broken: true } });

  await assert.rejects(
    login(),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Device authorization failed (HTTP 500). Register a CLI OAuth client with the device grant.",
  );
});

test("a refused device authorization says how to fix the client", async () => {
  useHome();
  serve({ ...DISCOVERY, "/oauth2/device_authorization": { status: 400, text: "unsupported_grant_type" } });

  await assert.rejects(
    login(),
    /Device authorization failed \(HTTP 400\)\. Register a CLI OAuth client with the device grant\. unsupported_grant_type/,
  );
});

test("each token polling error ends the login with its own message", async () => {
  useHome();
  const cases: Array<[Reply, RegExp]> = [
    [{ status: 400, body: { error: "expired_token" } }, /expired - run `superwall login` again/],
    [{ status: 400, body: { error: "access_denied" } }, /Login was denied/],
    [{ status: 400, body: { error: "invalid_client", error_description: "Unknown client" } }, /^Error: Unknown client$/],
    [{ status: 400, body: { error: "invalid_client" } }, /^Error: invalid_client$/],
    [{ status: 502, text: "<html>bad gateway</html>" }, /Token polling failed/],
  ];
  for (const [reply, message] of cases) {
    serve({ ...DISCOVERY, ...DEVICE, "/oauth2/token": reply });
    await assert.rejects(login(), (error: unknown) => message.test(String(error)));
  }
});

test("a device code that expires before approval times out", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    "/oauth2/device_authorization": {
      body: { device_code: "d", user_code: "U", verification_uri: "https://auth.test/device", expires_in: 0 },
    },
  });

  await assert.rejects(login(), /Login timed out/);
  assert.equal(sent.some((request) => request.url.endsWith("/oauth2/token")), false);
});

test("slow_down backs the polling off by five seconds", async () => {
  useHome();
  mock.timers.enable({ apis: ["setTimeout"] });
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": [{ status: 400, body: { error: "slow_down" } }, { body: { access_token: "at_1" } }],
    ...ORGS,
    ...ME,
  });
  const polls = () => sent.filter((request) => request.url.endsWith("/oauth2/token")).length;

  const pending = login();
  for (let i = 0; i < 200 && polls() < 1; i++) {
    mock.timers.tick(0);
    await waitForImmediate();
  }
  assert.equal(polls(), 1);
  for (let i = 0; i < 50; i++) await waitForImmediate();
  mock.timers.tick(4999);
  await waitForImmediate();
  assert.equal(polls(), 1);
  mock.timers.tick(1);
  const session = await pending;

  assert.equal(polls(), 2);
  assert.equal(session.accessToken, "at_1");
});

test("an account without an organization can't finish a login nobody can answer", async () => {
  useHome();
  serve({ ...DISCOVERY, ...DEVICE, "/oauth2/token": { body: { access_token: "at_1" } }, ...ME, ...NO_ORGS });

  await assert.rejects(login(), /no organization yet - run `superwall login` interactively/);
  assert.equal(readSession(), null);
});

test("cancelling onboarding cancels the login", async () => {
  useHome();
  serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1" } },
    ...ME,
    "/v2/me/organizations": { status: 500 },
  });

  await assert.rejects(login({ onOnboard: async () => null }), /^Error: Cancelled\.$/);
});

test("a machine that already onboarded an org skips onboarding while the API catches up", async () => {
  useHome();
  writeOnboardedOrg({ id: "7", name: "Acme" });
  serve({ ...DISCOVERY, ...DEVICE, "/oauth2/token": { body: { access_token: "at_1" } }, ...ME, ...NO_ORGS });

  const session = await login({
    onOnboard: async () => {
      throw new Error("must not onboard");
    },
  });

  assert.equal(session.accessToken, "at_1");
});

test("onboarding without an app creates the organization and activates it with a refreshed token", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": [
      { body: { access_token: "at_1", refresh_token: "rt_1" } },
      { body: { access_token: "at_2" } },
    ],
    ...ME,
    "/v2/me/organizations": [{ body: { data: [] } }, { body: { id: 42, name: "Acme Inc" } }],
  });
  const statuses: string[] = [];

  const session = await login({
    onOnboard: async () => ({ orgName: "Acme Inc" }),
    onStatus: (message) => statuses.push(message),
  });

  const created = sent.find((request) => request.method === "POST" && request.url.endsWith("/v2/me/organizations"));
  assert.deepEqual(jsonOf(created), { name: "Acme Inc" });
  assert.equal(created?.authorization, "Bearer at_1");
  assert.deepEqual(formOf(sent.at(-1)), {
    grant_type: "refresh_token",
    refresh_token: "rt_1",
    client_id: "client_test",
  });
  assert.deepEqual(statuses, ["Creating your account…", "Activating your organization…"]);
  assert.deepEqual(readOnboardedOrg(), { id: "42", name: "Acme Inc" });
  assert.equal(session.accessToken, "at_2");
});

test("onboarding with an app provisions it and keeps the old token when the refresh fails", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": [{ body: { access_token: "at_1", refresh_token: "rt_1" } }, { status: 400 }],
    ...ME,
    ...NO_ORGS,
    "/internal/v2/onboarding/provision": {
      body: {
        project: {
          id: 5,
          organization_id: 9,
          applications: [{ id: 55, public_api_key: "pk_new" }],
        },
      },
    },
  });
  const provisioned: unknown[] = [];

  const session = await login({
    onOnboard: async () => ({
      orgName: "Acme",
      app: { name: "Monoroll", platform: "ios", bundleId: "com.example.monoroll" },
    }),
    onProvisioned: (result) => provisioned.push(result),
  });

  assert.deepEqual(jsonOf(sent.find((request) => request.url.endsWith("/provision"))), {
    idempotency_key: readOnboardingIdempotencyKey(),
    organization: { name: "Acme" },
    applications: [{ name: "Monoroll", platform: "ios", bundle_id: "com.example.monoroll" }],
    marketing_metadata: { source: "cli" },
  });
  assert.deepEqual(provisioned, [
    { publicApiKey: "pk_new", projectId: "5", applicationId: "55", orgId: "9" },
  ]);
  assert.deepEqual(readOnboardedOrg(), { id: "9", name: "Acme" });
  assert.equal(session.accessToken, "at_1");
});

test("a provision that names nothing remembers no org, and no refresh token means no refresh", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1" } },
    ...ME,
    ...NO_ORGS,
    "/internal/v2/onboarding/provision": { body: {} },
  });
  const provisioned: unknown[] = [];

  await login({
    onOnboard: async () => ({ orgName: "Acme", app: { name: "Web", platform: "web" } }),
    onProvisioned: (result) => provisioned.push(result),
  });

  assert.deepEqual(jsonOf(sent.find((request) => request.url.endsWith("/provision"))), {
    idempotency_key: readOnboardingIdempotencyKey(),
    organization: { name: "Acme" },
    applications: [{ name: "Web", platform: "web" }],
    marketing_metadata: { source: "cli" },
  });
  assert.deepEqual(provisioned, [
    { publicApiKey: undefined, projectId: undefined, applicationId: undefined, orgId: undefined },
  ]);
  assert.equal(readOnboardedOrg(), undefined);
  assert.equal(sent.filter((request) => request.url.endsWith("/oauth2/token")).length, 1);
});

test("a refresh that can't connect keeps the first token", async () => {
  useHome();
  serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": [{ body: { access_token: "at_1", refresh_token: "rt_1" } }, { fail: true }],
    ...ME,
    "/v2/me/organizations": [{ body: {} }, { body: { id: 1, name: "Acme" } }],
  });

  const session = await login({ onOnboard: async () => ({ orgName: "Acme" }) });

  assert.equal(session.accessToken, "at_1");
});

test("an id token the API refuses doesn't stop the login", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1", id_token: "id_1" } },
    "/v2/me": { status: 401 },
    ...ORGS,
  });

  const session = await login();

  assert.deepEqual(
    sent.filter((request) => request.url.endsWith("/v2/me")).map((request) => request.authorization),
    ["Bearer id_1", "Bearer at_1"],
  );
  assert.equal(session.accessToken, "at_1");
});

test("a refused organization whose body breaks off still reports the status", async () => {
  useHome();
  serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1" } },
    ...ME,
    "/v2/me/organizations": [{ body: { data: [] } }, { status: 500, broken: true }],
  });

  await assert.rejects(
    login({ onOnboard: async () => ({ orgName: "Acme" }) }),
    (error: unknown) =>
      error instanceof Error && error.message === "POST https://api.test/v2/me/organizations failed (HTTP 500).",
  );
});

test("a refused organization says what the API answered", async () => {
  useHome();
  serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1" } },
    ...ME,
    "/v2/me/organizations": [{ body: { data: [] } }, { status: 422, text: "name taken" }],
  });

  await assert.rejects(
    login({ onOnboard: async () => ({ orgName: "Acme" }) }),
    /POST https:\/\/api\.test\/v2\/me\/organizations failed \(HTTP 422\)\. name taken/,
  );
});

function contextFor(renderer: Renderer, installDir: string): CommandContext<"none"> {
  useRenderer(renderer);
  return {
    ui: renderer,
    output: createCommandOutput("text", renderer),
    outputMode: "text",
    interactive: true,
    installDir,
    json: false,
    dryRun: false,
    target: {},
    fail: () => {
      process.exitCode = 1;
    },
  };
}

function scripted(calls: RendererCall[], answers: { confirm?: boolean[]; text?: string[] }): Renderer {
  return {
    ...recordingRenderer(calls),
    confirm: async (value) => (calls.push({ method: "confirm", value }), answers.confirm?.shift() ?? null),
    text: async (value) => (calls.push({ method: "text", value }), answers.text?.shift() ?? null),
  };
}

function useAppDir(withApp: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-login-"));
  dirs.push(dir);
  if (withApp) {
    fs.mkdirSync(path.join(dir, "Monoroll"));
    fs.writeFileSync(path.join(dir, "Monoroll", "Package.swift"), "// swift-tools-version:5.9\n");
  }
  return dir;
}

const said = (calls: RendererCall[], method: string) =>
  calls.filter((call) => call.method === method).map((call) => String(call.value));

const flags = { apiKey: undefined, host: "https://auth.test", clientId: "client_test" };

const markSkillsFresh = () =>
  writeSkillsSync({ cliVersion: VERSION, syncedAt: new Date().toISOString(), ref: SKILLS_REF() });

test("an API key login without an organization still logs in", async () => {
  useHome();
  process.env.SUPERWALL_API_HOST = "https://api.test";
  const sent = serve({ "/v2/me/organizations": { body: { data: [] } } });
  const calls: RendererCall[] = [];

  await runLogin(contextFor(recordingRenderer(calls), useAppDir(false)), {
    flags: { ...flags, apiKey: "  sk_live  " },
  });

  assert.equal(sent[0]?.authorization, "Bearer sk_live");
  assert.deepEqual(said(calls, "success"), ["Logged in with an API key."]);
  assert.equal(readSession()?.apiKey, "sk_live");
  assert.equal(readSession()?.orgName, undefined);
});

test("a browser login shows the code, warns when no browser opened, and names the account", async () => {
  useHome();
  process.env.SUPERWALL_API_HOST = "https://api.test";
  markSkillsFresh();
  serve({ ...DISCOVERY, ...DEVICE, "/oauth2/token": { body: { access_token: "at_1" } }, ...ME, ...ORGS });
  const calls: RendererCall[] = [];

  await runLogin(contextFor(recordingRenderer(calls), useAppDir(false)), {
    flags,
    openBrowser: async () => false,
  });

  assert.deepEqual(said(calls, "intro"), ["Superwall login"]);
  assert.deepEqual(said(calls, "info"), [
    "Approve this login in your browser · code `ABCD-EFGH`\nhttps://auth.test/device",
  ]);
  assert.deepEqual(said(calls, "warn"), [
    "Couldn't open a browser here. Open the URL above to approve the login.",
  ]);
  assert.deepEqual(said(calls, "spinner.start"), ["Waiting for you to approve in the browser"]);
  assert.deepEqual(said(calls, "spinner.stop"), ["Logged in as `new@example.com`"]);
  assert.deepEqual(said(calls, "outro"), [
    "You're all set - run `superwall integrate` to set up your app.",
  ]);
  assert.equal(readSession()?.accessToken, "at_1");
});

test("a first browser login provisions the detected app and says it is ready", async () => {
  useHome();
  process.env.SUPERWALL_API_HOST = "https://api.test";
  markSkillsFresh();
  serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": [
      { status: 400, body: { error: "authorization_pending" } },
      { body: { access_token: "at_1" } },
    ],
    "/v2/me": { body: {} },
    ...NO_ORGS,
    "/internal/v2/onboarding/provision": {
      body: {
        project: { id: 5, organization_id: 9, applications: [{ id: 55, public_api_key: "pk_new" }] },
      },
    },
  });
  const calls: RendererCall[] = [];
  const dir = useAppDir(true);

  await runLogin(contextFor(scripted(calls, { confirm: [true], text: ["Acme"] }), dir), {
    flags,
    openBrowser: async () => true,
  });

  assert.deepEqual(said(calls, "warn"), []);
  assert.deepEqual(said(calls, "spinner.message"), [
    "Waiting for you to approve in the browser…",
    "Creating your account…",
  ]);
  assert.deepEqual(said(calls, "spinner.start"), [
    "Waiting for you to approve in the browser",
    "Creating your account",
  ]);
  assert.deepEqual(said(calls, "spinner.stop"), ["Logged in as `you`"]);
  assert.deepEqual(said(calls, "outro"), [
    "Your app is ready - run `superwall integrate` to set up the SDK.",
  ]);
  assert.deepEqual(readOnboardedApp(path.join(dir, "Monoroll")), {
    publicApiKey: "pk_new",
    projectId: "5",
    applicationId: "55",
  });
});

test("a browser login whose onboarding is cancelled fails without creating anything", async () => {
  useHome();
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1" } },
    ...ME,
    ...NO_ORGS,
  });
  const calls: RendererCall[] = [];

  await assert.rejects(
    runLogin(contextFor(scripted(calls, {}), useAppDir(false)), {
      flags,
      openBrowser: async () => true,
    }),
    /Cancelled/,
  );

  assert.deepEqual(said(calls, "spinner.stop"), ["Login failed"]);
  assert.equal(sent.some((request) => request.method === "POST" && request.url.includes("/v2/")), false);
  assert.equal(readSession(), null);
});

test("a directory that can't be scanned onboards without a detected app", async () => {
  useHome();
  process.env.SUPERWALL_API_HOST = "https://api.test";
  markSkillsFresh();
  const sent = serve({
    ...DISCOVERY,
    ...DEVICE,
    "/oauth2/token": { body: { access_token: "at_1" } },
    ...ME,
    "/v2/me/organizations": [{ body: { data: [] } }, { body: { id: 3, name: "Acme" } }],
  });
  const calls: RendererCall[] = [];
  const notADirectory = path.join(useAppDir(false), "file");
  fs.writeFileSync(notADirectory, "");

  await runLogin(contextFor(scripted(calls, { text: ["Acme"] }), notADirectory), {
    flags,
    openBrowser: async () => true,
  });

  assert.deepEqual(said(calls, "confirm"), []);
  assert.equal(sent.some((request) => request.url.endsWith("/provision")), false);
  assert.deepEqual(said(calls, "outro"), [
    "You're all set - run `superwall integrate` to set up your app.",
  ]);
});
