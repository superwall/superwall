import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { claudeDriver } from "@/core/workflows/agent/drivers/claude";
import { superwallDriver } from "@/core/workflows/agent/drivers/superwall";
import { readSession, type Session } from "@/core/account/storage";
import { scanProject } from "@/core/codebase/scan";
import { ensureAgentDriverReady, pickApp, recoverUnmatchedScope, stage } from "@/core/workflows/app";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { answeringRenderer, prompted, said, type Answers } from "../../helpers/answers";
import { restoreFetch, useFetch, type Route } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import type { RendererCall } from "../../helpers/renderer";
import {
  API_HOST,
  clearLoginHosts,
  expoApp,
  iosApp,
  loginRoutes,
  restoreSandboxPath,
  useLoginHosts,
  useSandboxPath,
} from "../../helpers/workflow";

beforeEach(() => {
  useSandboxPath();
});

afterEach(() => {
  restoreFetch();
  restoreSandboxPath();
  clearLoginHosts();
  clearHomes();
  selectRenderer({ mode: "text" });
});

function answering(answers: Answers = {}): RendererCall[] {
  const calls: RendererCall[] = [];
  useRenderer(answeringRenderer(answers, calls));
  return calls;
}

const page = (data: unknown[]) => ({ data, has_more: false });
const KEY = "pk_live_mine1234";
const OAUTH: Partial<Session> = {
  authMethod: "oauth",
  accessToken: "token-1",
  refreshToken: "refresh-1",
  accessTokenExpiresAt: Date.now() + 3_600_000,
};

async function detected() {
  const app = (await scanProject(iosApp())).apps[0];
  assert.ok(app);
  return app;
}

test("an unmatched key can be left for later", async () => {
  useHome({ authMethod: "api_key", apiKey: "sk_live_x", orgName: "Acme Inc" });
  const calls = answering({ select: ["skip"] });
  assert.equal(await recoverUnmatchedScope(await detected(), KEY), null);
  assert.deepEqual(said(calls, "error"), [
    `This project's API key (\`${KEY}\`) doesn't match any app in \`Acme Inc\`. You might be logged in to the wrong account.`,
  ]);

  const dismissed = answering({ select: [null] });
  assert.equal(await recoverUnmatchedScope(await detected(), KEY), null);
  assert.equal(prompted(dismissed, "select").length, 1);
});

test("logging in as someone else finds the app the key belongs to", async () => {
  useHome({ authMethod: "api_key", apiKey: "sk_live_x" });
  useLoginHosts();
  const projects = [{ id: 5, name: "Theirs", applications: [{ id: 50, name: "Acme", bundle_id: "com.acme", public_api_key: KEY }] }];
  useFetch([{ match: `${API_HOST}/v2/projects`, body: page(projects) }, ...loginRoutes()]);
  const calls = answering({ select: ["relogin"] });
  const recovered = await recoverUnmatchedScope(await detected(), KEY);
  assert.match(said(calls, "error")[0] ?? "", /in the apps this account can open\./);
  assert.deepEqual(recovered, { scope: { projectId: "5", applicationId: "50", appName: "Acme" }, bundleId: "com.acme" });
  assert.deepEqual(said(calls, "success"), ["Found `Acme`"]);
  assert.equal(readSession()?.accessToken, "token-1");
});

test("an account that doesn't have the key either asks again, and the app's own name stands in for an unnamed one", async () => {
  useHome({ authMethod: "api_key", apiKey: "sk_live_x" });
  useLoginHosts();
  useFetch([{ match: `${API_HOST}/v2/projects`, body: page([]) }, ...loginRoutes()]);
  const calls = answering({ select: ["relogin", "skip"] });
  assert.equal(await recoverUnmatchedScope(await detected(), KEY), null);
  assert.equal(prompted(calls, "select").length, 2);

  useFetch([
    { match: `${API_HOST}/v2/projects`, body: page([{ id: 5, applications: [{ id: 50, public_api_key: KEY }] }]) },
    ...loginRoutes(),
  ]);
  answering({ select: ["relogin"] });
  const recovered = await recoverUnmatchedScope(await detected(), KEY);
  assert.equal(recovered?.scope.appName, "Acme");
});

test("an account that can't list its projects after logging in asks again", async () => {
  useHome({ authMethod: "api_key", apiKey: "sk_live_x" });
  useLoginHosts();
  useFetch([{ match: `${API_HOST}/v2/projects`, status: 500, body: { message: "down" } }, ...loginRoutes()]);
  const calls = answering({ select: ["relogin", null] });
  assert.equal(await recoverUnmatchedScope(await detected(), KEY), null);
  assert.equal(prompted(calls, "select").length, 2);
});

test("a login that fails while recovering gives up", async () => {
  useHome({ authMethod: "api_key", apiKey: "sk_live_x" });
  useLoginHosts();
  useFetch([{ match: "/.well-known/openid-configuration", status: 500, body: {} }]);
  answering({ select: ["relogin"] });
  assert.equal(await recoverUnmatchedScope(await detected(), KEY), null);
  assert.equal(readSession(), null);
});

test("connecting the app to this account hands back a new key to swap in", async () => {
  useHome({ authMethod: "api_key", apiKey: "sk_live_x", orgName: "Acme Inc" });
  const projects = [
    { id: 1, name: "Lab", applications: [{ id: 10, name: "Acme iOS", platform: "ios", bundle_id: "com.acme", public_api_key: "pk_live_theirs99" }] },
  ];
  useFetch([{ match: "/v2/projects", body: page(projects) }]);
  const calls = answering({ select: ["bind", "1", "10"] });
  const recovered = await recoverUnmatchedScope(await detected(), KEY);
  assert.deepEqual(recovered, { scope: { projectId: "1", applicationId: "10", appName: "Acme" }, bundleId: "com.acme" });
  assert.deepEqual(calls.find((call) => call.method === "note")?.value, {
    value: `Your code still uses \`${KEY}\`.\nReplace it with \`pk_live_theirs99\` so the app talks to \`Acme Inc\`.`,
    title: "Swap the API key",
  });
});

test("connecting goes back to the question when no app is picked, or when it fails", async () => {
  useHome({ authMethod: "api_key", apiKey: "sk_live_x" });
  useFetch([{ match: "/v2/projects", body: page([{ id: 1, name: "Lab", applications: [{ id: 10, name: "Keyless", platform: "ios" }] }]) }]);
  const keyless = answering({ select: ["bind", "1", "10", "skip"] });
  assert.equal(await recoverUnmatchedScope(await detected(), KEY), null);
  assert.deepEqual(said(keyless, "warn"), ["`Keyless` has no SDK key yet - pick another or add a new app."]);

  useFetch([{ match: "/v2/projects", status: 500, body: { message: "projects are down" } }]);
  const failing = answering({ select: ["bind", "skip"] });
  assert.equal(await recoverUnmatchedScope(await detected(), KEY), null);
  assert.deepEqual(said(failing, "warn"), ["projects are down"]);
});

test("Claude Code and Codex are always ready, and so is anything on a dry run", async () => {
  const never = async () => assert.fail("must not log in");
  assert.equal(await ensureAgentDriverReady(claudeDriver, never, false), true);
  assert.equal(await ensureAgentDriverReady(superwallDriver, never, true), true);
});

test("the Superwall Agent needs a browser login with credit left", async () => {
  useHome();
  let calls = answering();
  assert.equal(await ensureAgentDriverReady(superwallDriver, async () => false, false), false);
  assert.match(said(calls, "warn")[0] ?? "", /^Superwall Agent needs sign-in\./);

  useHome({ authMethod: "api_key", apiKey: "sk_live_x" });
  calls = answering();
  assert.equal(await ensureAgentDriverReady(superwallDriver, async () => true, false), false);
  assert.match(said(calls, "warn")[0] ?? "", /needs an OAuth login/);

  const status: Route = { match: "/v2/cli-agent/status", body: { limit: 10, usage: 10, remaining: 0, exhausted: true, model: "m" } };
  useHome(OAUTH);
  useFetch([status]);
  calls = answering();
  assert.equal(await ensureAgentDriverReady(superwallDriver, async () => true, false), false);
  assert.match(said(calls, "warn")[0] ?? "", /credit is exhausted/);

  useFetch([{ ...status, body: { limit: 10, usage: 1, remaining: 9, exhausted: false, model: "m" } }]);
  calls = answering();
  assert.equal(await ensureAgentDriverReady(superwallDriver, async () => true, false), true);
  assert.deepEqual(said(calls, "spinner.stop"), ["Checking Superwall Agent credit"]);
});

test("one app found is used, and where it sits is said", async () => {
  const root = path.dirname(expoApp());
  const calls = answering();
  const app = await pickApp(root, false);
  assert.equal(app?.name, "Acme");
  assert.deepEqual(said(calls, "info"), ["Detected `Expo (React Native)` · `Expo 51.0.0`  (Acme)"]);

  const bare = answering();
  await pickApp(iosApp(), false);
  assert.deepEqual(said(bare, "info"), ["Detected `Swift (iOS)` · `Swift`"]);
});

test("no app here is an error naming what was skipped, and a web app is turned away", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sw-pick-"));
  answering();
  await assert.rejects(pickApp(empty, false), /^Error: No .* app found in this directory\.$/);

  fs.mkdirSync(path.join(empty, "tools"));
  fs.writeFileSync(path.join(empty, "tools", "package.json"), "{}");
  await assert.rejects(pickApp(empty, false), /app found in this directory\. Skipped: tools\.$/);

  const web = fs.mkdtempSync(path.join(os.tmpdir(), "sw-pick-web-"));
  fs.writeFileSync(path.join(web, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }));
  await assert.rejects(pickApp(web, false), /^Error: Detected a web app \(`next`\)\. This command supports mobile apps\.$/);
});

test("several apps need a choice: asked in a terminal, refused outside one", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sw-pick-many-"));
  for (const name of ["one", "two"]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, "package.json"), JSON.stringify({ dependencies: { expo: "51.0.0" } }));
  }
  fs.mkdirSync(path.join(root, "site"));
  fs.writeFileSync(path.join(root, "site", "package.json"), JSON.stringify({ name: "site", dependencies: { next: "15.0.0" } }));

  const calls = answering();
  await assert.rejects(pickApp(root, false), /Multiple apps found\. Pass --install-dir/);
  assert.deepEqual(said(calls, "info"), ["Also found unsupported web apps: site"]);

  const chosen = answering({ select: [path.join(root, "two")] });
  assert.equal((await pickApp(root, true))?.name, "two");
  const select = chosen.find((call) => call.method === "select")?.value as { message: string; options: { label: string; hint?: string }[] };
  assert.equal(select.message, "Found multiple apps - which one?");
  assert.deepEqual(select.options.map((option) => [option.label, option.hint]).sort(), [
    ["one · Expo (React Native)", "one"],
    ["two · Expo (React Native)", "two"],
  ]);

  answering({ select: [null] });
  assert.equal(await pickApp(root, true), null);
});

test("a stage is announced before its work runs", async () => {
  const calls = answering();
  const order: string[] = [];
  await stage("Step 2 · Products", () => {
    order.push(calls.map((call) => call.method).join());
  });
  assert.deepEqual(said(calls, "step"), ["Step 2 · Products"]);
  assert.deepEqual(order, ["step"]);
});
