import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { Session } from "@/core/account/storage";
import { writeOnboardedApp } from "@/core/state/config";
import { runIntegrate, runReview } from "@/core/workflows/integrate";
import type { CommandContext } from "@/program/command";
import { prompted, said, type Answers } from "../../helpers/answers";
import { restoreFetch, useFetch, type Route } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import {
  API_HOST,
  INTEGRATED,
  clearLoginHosts,
  expoApp,
  iosApp,
  loginRoutes,
  restoreSandboxPath,
  runWorkflow,
  useAgents,
  useLoginHosts,
  useSandboxPath,
} from "../../helpers/workflow";

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.SUPERWALL_API_KEY;
  delete process.env.SUPERWALL_API_KEY;
  useSandboxPath();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = savedKey;
  mock.restoreAll();
  restoreFetch();
  restoreSandboxPath();
  clearLoginHosts();
  clearHomes();
});

const API_KEY_SESSION: Partial<Session> = { authMethod: "api_key", apiKey: "sk_live_x", orgName: "Acme Inc" };
const KEY = "pk_live_abcdef123";
const page = (data: unknown[]) => ({ data, has_more: false });
const ACME_PROJECTS = [
  { id: 1, name: "Lab", organization_id: 9, applications: [{ id: 10, name: "Acme", platform: "ios", bundle_id: "com.acme", public_api_key: KEY }] },
];

function accountRoutes(host = "https://api.example.com", projects: unknown[] = ACME_PROJECTS): Route[] {
  return [
    { match: `${host}/v2/products?project_id=1`, body: page([{ id: "p1", identifier: "pro" }]) },
    { match: `${host}/v2/campaigns?application_id=10`, body: page([]) },
    { match: `${host}/v2/projects`, body: page(projects) },
  ];
}

type IntegrateInput = { apiKey?: string; driver?: string };

function integrate(installDir: string, input: IntegrateInput, options: { answers?: Answers; interactive?: boolean; dryRun?: boolean } = {}) {
  return runWorkflow(
    (ctx: CommandContext<"optional">) => runIntegrate({ ...ctx, apiKey: input.apiKey, driver: input.driver }),
    { installDir, ...options },
  );
}

function review(installDir: string, fix: boolean, options: { answers?: Answers; interactive?: boolean; dryRun?: boolean } = {}) {
  return runWorkflow((ctx: CommandContext<"optional">) => runReview(ctx, fix), { installDir, ...options });
}

const steps = (calls: Parameters<typeof said>[0]) => said(calls, "step");

test("integrate with no coding agent explains the manual setup", async () => {
  useHome();
  useFetch([]);
  useAgents({});
  const { calls, failed } = await integrate(expoApp(), {});
  assert.equal(failed, false);
  assert.deepEqual(said(calls, "warn"), ["No coding agent found."]);
  assert.deepEqual(
    calls.filter((call) => call.method === "note").map((call) => (call.value as { title: string }).title),
    ["Manual setup", "Automated setup"],
  );
  assert.deepEqual(said(calls, "outro"), ["Re-run `superwall integrate` after installing an agent."]);
});

test("integrate --driver refuses an agent that isn't installed", async () => {
  useHome();
  useFetch([]);
  useAgents({ claude: [] });
  const { calls, failed } = await integrate(expoApp(), { driver: "codex" });
  assert.equal(failed, true);
  assert.deepEqual(said(calls, "error"), ['Driver "codex" not available. Detected: claude.']);
});

test("headless integrate without a login applies the SDK but fails the run as incomplete", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [{ ok: true }], codex: [] });
  const app = expoApp();
  const { calls, failed } = await integrate(app, { apiKey: "pk_flag_123456" }, { interactive: false });
  assert.equal(failed, true);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.driver, "claude");
  assert.equal(runs[0]?.options.cwd, app);
  assert.match(runs[0]?.options.prompt ?? "", /pk_flag_123456/);
  assert.deepEqual(steps(calls), ["Step 1 · Integrate the SDK"]);
  assert.match(said(calls, "warn").join("\n"), /headless mode cannot run the placements\/campaigns stages/);
  assert.deepEqual(said(calls, "spinner.stop").slice(-2), ["Integration complete", "Superwall skills installed"]);
  assert.match(said(calls, "outro").at(-1) ?? "", /^Done\./);
});

test("integrate passes over the agent it falls back from when the first hits its usage limit", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [{ ok: false, failureReason: "usage-limit" }], codex: [{ ok: true }] });
  await integrate(expoApp(), { apiKey: "pk_flag_123456" }, { interactive: false });
  assert.deepEqual(runs.map((run) => run.driver), ["claude", "codex"]);
});

test("headless integrate with a login finds the app's key, then sets up products, campaigns and checks", async () => {
  useHome(API_KEY_SESSION);
  useFetch(accountRoutes());
  const runs = useAgents({ claude: [{ ok: true }] });
  const { calls, failed } = await integrate(expoApp(), {}, { interactive: false, answers: { select: [null], confirm: [null] } });
  assert.equal(failed, false, said(calls, "error").join());
  assert.match(runs[0]?.options.prompt ?? "", new RegExp(KEY));
  assert.ok(said(calls, "info").includes("Using app `Acme`"));
  assert.deepEqual(steps(calls), [
    "Step 1 · Integrate the SDK",
    "Step 2 · Products",
    "Step 3 · Campaigns & Placements",
    "Step 4 · Paywall",
    "Step 5 · Verify",
  ]);
  assert.deepEqual(said(calls, "success").slice(-2), ["Products in Superwall: 1", "1 product already in Superwall."].reverse());
  assert.equal(process.env.SUPERWALL_API_KEY, "sk_live_x");
});

test("an app already set up skips the SDK step and resolves the app from its key", async () => {
  useHome(API_KEY_SESSION);
  useFetch(accountRoutes());
  const runs = useAgents({ claude: [] });
  const app = expoApp(INTEGRATED, { "expo-superwall": "1.0.0" });
  const { calls, failed } = await integrate(app, {}, { interactive: false, answers: { select: [null], confirm: [null] } });
  assert.equal(failed, false, said(calls, "error").join());
  assert.deepEqual(runs, []);
  assert.deepEqual(said(calls, "success")[0], "Superwall is already set up in `Acme`.");
  assert.ok(said(calls, "info").includes("SDK already integrated - skipped."));
  assert.equal(steps(calls).length, 5);
});

test("a partial setup is named, and a dry run changes nothing", async () => {
  useHome();
  const log = useFetch([]);
  const runs = useAgents({ claude: [] });
  const app = expoApp({ "App.tsx": `const key = "${KEY}";` });
  const { calls, failed } = await integrate(app, {}, { interactive: false, dryRun: true });
  assert.equal(failed, false, said(calls, "error").join());
  assert.deepEqual(runs, []);
  assert.deepEqual(steps(calls), ["Step 1 · Integrate the SDK"]);
  assert.equal(log.filter((entry) => entry.url.includes("/v2/")).length, 0);
});

test("a RevenueCat app is asked what Superwall is for, and dismissing that stops", async () => {
  useHome();
  useFetch([]);
  useAgents({ claude: [] });
  const app = expoApp({}, { "react-native-purchases": "7.0.0" });
  const dismissed = await integrate(app, {}, { answers: { select: [null] } });
  assert.deepEqual(prompted(dismissed.calls, "select"), ["You're using `RevenueCat`. What do you want Superwall for?"]);
  assert.deepEqual(steps(dismissed.calls), []);

  const paywalls = await integrate(app, { apiKey: "pk_flag_123456" }, { answers: { select: ["paywalls"] }, dryRun: true });
  assert.ok(said(paywalls.calls, "info").includes("RevenueCat: `paywalls`"));
  assert.deepEqual(steps(paywalls.calls), ["Step 1 · Integrate the SDK"]);
});

test("in a terminal the integration prompt can be copied instead of run", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [] });
  const { calls } = await integrate(expoApp(), { apiKey: "pk_flag_123456" }, { answers: { select: ["copy"] } });
  assert.deepEqual(runs, []);
  assert.deepEqual(prompted(calls, "select"), ["Integrate the Superwall SDK into `Acme`?"]);
  assert.deepEqual(said(calls, "outro"), ["Paste it into your agent, then run `superwall integrate` to continue."]);

  const cancelled = await integrate(expoApp(), { apiKey: "pk_flag_123456" }, { answers: { select: [null] } });
  assert.deepEqual(said(cancelled.calls, "warn"), ["Cancelled."]);
});

test("the Superwall Agent without a login falls back to copying the prompt", async () => {
  useHome();
  useLoginHosts();
  useFetch([{ match: "/.well-known/openid-configuration", status: 500, body: {} }]);
  const runs = useAgents({ superwall: [] });
  const { calls } = await integrate(expoApp(), { apiKey: "pk_flag_123456" }, { answers: { select: ["now"] } });
  assert.deepEqual(runs, []);
  assert.match(said(calls, "warn").join("\n"), /Superwall Agent needs sign-in/);
  assert.deepEqual(said(calls, "outro"), ["Paste it into your agent, or run `superwall login` and try again."]);

  const headless = await integrate(expoApp(), { apiKey: "pk_flag_123456" }, { interactive: false });
  assert.deepEqual(said(headless.calls, "outro"), []);
});

test("an app created during onboarding is used, with its project, in a terminal", async () => {
  useHome(API_KEY_SESSION);
  useFetch(accountRoutes());
  const runs = useAgents({ claude: [{ ok: true }] });
  const app = expoApp();
  writeOnboardedApp(app, { publicApiKey: "pk_onboarded_1234", projectId: "1", applicationId: "10" });
  const { calls, failed } = await integrate(app, {}, { answers: { select: ["now", "__skip__"], confirm: [false] } });
  assert.equal(failed, false, said(calls, "error").join());
  assert.ok(said(calls, "info").includes("Using `Acme` - created during onboarding."));
  assert.match(runs[0]?.options.prompt ?? "", /pk_onboarded_1234/);
  assert.equal(steps(calls).length, 5);
});

test("an app remembered without its project still finds the project from its key", async () => {
  useHome(API_KEY_SESSION);
  useFetch(accountRoutes());
  useAgents({ claude: [{ ok: true }] });
  const app = expoApp();
  writeOnboardedApp(app, { publicApiKey: KEY });
  const { calls, failed } = await integrate(app, {}, { answers: { select: ["now", "__skip__"], confirm: [false] } });
  assert.equal(failed, false, said(calls, "error").join());
  assert.equal(steps(calls).length, 5);
});

test("signed in with no key here, the app is picked from the account", async () => {
  useHome(API_KEY_SESSION);
  useFetch(accountRoutes());
  useAgents({ claude: [{ ok: true }] });
  const { calls, failed } = await integrate(expoApp(), {}, {
    answers: { select: ["1", "10", "now", "__skip__"], confirm: [false] },
  });
  assert.equal(failed, false, said(calls, "error").join());
  assert.ok(said(calls, "success").includes("Using `Acme` (iOS)"));
  assert.equal(steps(calls).length, 5);
});

test("dismissing the app picker cancels, and a failing account falls back to asking for a key", async () => {
  useHome(API_KEY_SESSION);
  useFetch(accountRoutes());
  useAgents({ claude: [] });
  const cancelled = await integrate(expoApp(), {}, { answers: { select: [null] } });
  assert.deepEqual(said(cancelled.calls, "warn"), ["Cancelled."]);

  useFetch([{ match: "/v2/projects", status: 500, body: { message: "projects are down" } }]);
  const failing = await integrate(expoApp(), {}, { answers: {} });
  assert.equal(failing.failed, true);
  assert.deepEqual(said(failing.calls, "warn"), ["projects are down"]);
  assert.deepEqual(said(failing.calls, "error"), ["Couldn't connect your app - re-run and complete the browser login."]);
});

test("a key that matches no app this account can open is offered a fix, and skipping fails the run", async () => {
  useHome(API_KEY_SESSION);
  useFetch(accountRoutes("https://api.example.com", []));
  useAgents({ claude: [] });
  const app = expoApp(INTEGRATED, { "expo-superwall": "1.0.0" });
  const { calls, failed } = await integrate(app, {}, { answers: { select: ["skip"] } });
  assert.equal(failed, true);
  assert.deepEqual(said(calls, "error"), [
    `This project's API key (\`${KEY}\`) doesn't match any app in \`Acme Inc\`. You might be logged in to the wrong account.`,
    "Couldn't connect this app to Superwall - set it up in the dashboard, or re-run to try again.",
  ]);
});

test("a key that matches no app is fixed by connecting the app to this account", async () => {
  useHome(API_KEY_SESSION);
  const projects = [{ id: 1, name: "Lab", applications: [{ id: 10, name: "Other", platform: "react_native", public_api_key: "pk_live_other99" }] }];
  useFetch(accountRoutes("https://api.example.com", projects));
  useAgents({ claude: [] });
  const app = expoApp(INTEGRATED, { "expo-superwall": "1.0.0" });
  const { calls, failed } = await integrate(app, {}, {
    answers: { select: ["bind", "1", "10", "__skip__"], confirm: [false] },
  });
  assert.equal(failed, false, said(calls, "error").join());
  assert.equal(steps(calls).length, 5);
});

test("a first login that creates the app uses it right away", async () => {
  useHome();
  useLoginHosts();
  useFetch([
    {
      match: `${API_HOST}/internal/v2/onboarding/provision`,
      body: { project: { id: 1, organization_id: 9, applications: [{ id: 10, public_api_key: "pk_new_123456" }] } },
    },
    ...accountRoutes(API_HOST),
    ...loginRoutes([]),
  ]);
  const runs = useAgents({ claude: [{ ok: true }] });
  const { calls, failed } = await integrate(iosApp(), {}, {
    answers: { confirm: [true, false], text: ["Acme Inc"], select: ["now", "__skip__"] },
  });
  assert.equal(failed, false, said(calls, "error").join());
  assert.ok(said(calls, "success").includes("Created `Acme` in Superwall"));
  assert.match(runs[0]?.options.prompt ?? "", /pk_new_123456/);
  assert.equal(steps(calls).length, 5);
});

test("a dry run of an app already set up does nothing in a terminal", async () => {
  useHome(API_KEY_SESSION);
  const log = useFetch(accountRoutes());
  useAgents({ claude: [] });
  const app = expoApp(INTEGRATED, { "expo-superwall": "1.0.0" });
  const { calls, failed } = await integrate(app, {}, { answers: {}, dryRun: true });
  assert.equal(failed, false, said(calls, "error").join());
  assert.deepEqual(steps(calls), ["Step 1 · Integrate the SDK"]);
  assert.equal(log.filter((entry) => entry.url.includes("/v2/products")).length, 0);
});

test("review with no coding agent explains the manual setup", async () => {
  useHome();
  useFetch([]);
  useAgents({});
  const { calls } = await review(expoApp(), false);
  assert.deepEqual(said(calls, "warn"), ["No coding agent found."]);
});

test("review stops when no app is picked", async () => {
  useHome();
  useFetch([]);
  useAgents({ claude: [] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sw-review-many-"));
  for (const name of ["one", "two"]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, "package.json"), JSON.stringify({ dependencies: { expo: "51.0.0" } }));
  }
  const { calls } = await review(root, false, { answers: { select: [null] } });
  assert.deepEqual(said(calls, "warn"), ["Cancelled."]);
});

test("review --dry-run shows the plan", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ codex: [] });
  const app = expoApp(INTEGRATED, { "expo-superwall": "1.0.0" });
  const { calls } = await review(app, false, { interactive: false, dryRun: true });
  assert.deepEqual(runs, []);
  assert.deepEqual(said(calls, "success"), ["Superwall is already set up in `Acme`."]);
  const plan = calls.find((call) => call.method === "note")?.value as { value: string; title: string };
  assert.equal(plan.title, "Plan");
  assert.match(plan.value, /^Agent:    Codex\nAction:   Review the setup/);
  assert.deepEqual(said(calls, "outro"), ["Dry run - no changes made."]);
});

test("review runs read-only and keeps its report for a later fix", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [{ ok: true, finalText: "## Issues\n- no placements" }] });
  const app = expoApp({ "App.tsx": `const key = "${KEY}";` });
  const { calls, failed } = await review(app, false, { interactive: false });
  assert.equal(failed, false, said(calls, "error").join());
  assert.equal(runs[0]?.options.capabilities.filesystem, "read");
  assert.deepEqual(said(calls, "report"), ["## Issues\n- no placements"]);
  assert.equal(fs.readFileSync(path.join(app, ".superwall", "review.md"), "utf8"), "## Issues\n- no placements");
  assert.deepEqual(said(calls, "outro"), []);
});

test("review --fix hands the agent the earlier review's report", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [{ ok: true }] });
  const app = expoApp({ ".superwall/review.md": "## Issues\n- missing restore button" });
  const { failed } = await review(app, true, { interactive: false });
  assert.equal(failed, false);
  assert.equal(runs[0]?.options.capabilities.filesystem, "write");
  assert.match(runs[0]?.options.prompt ?? "", /missing restore button/);
});

test("review with the Superwall Agent and no login does nothing", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ superwall: [] });
  const { calls, failed } = await review(expoApp(), false, { interactive: false });
  assert.equal(failed, false);
  assert.deepEqual(runs, []);
  assert.match(said(calls, "warn").join(), /Superwall Agent needs sign-in/);
});

test("--driver keeps to that agent even when it runs out of usage", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [{ ok: false, failureReason: "usage-limit" }], codex: [] });
  const { calls, failed } = await integrate(expoApp(), { apiKey: "pk_flag_123456", driver: "claude" }, { interactive: false });
  assert.equal(failed, true);
  assert.deepEqual(runs.map((run) => run.driver), ["claude"]);
  assert.deepEqual(said(calls, "error"), ["Integrate the SDK did not complete."]);
});

test("integrate stops quietly when no app is picked", async () => {
  useHome();
  useFetch([]);
  useAgents({ claude: [] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sw-integrate-many-"));
  for (const name of ["one", "two"]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, "package.json"), JSON.stringify({ dependencies: { expo: "51.0.0" } }));
  }
  const { calls, failed } = await integrate(root, {}, { answers: { select: [null] } });
  assert.equal(failed, false);
  assert.deepEqual(steps(calls), []);
});

test("an installed SDK without its configure call is a partial setup that still gets integrated", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [{ ok: true }] });
  const { calls } = await integrate(expoApp({}, { "expo-superwall": "1.0.0" }), { apiKey: "pk_flag_123456" }, { interactive: false });
  assert.ok(said(calls, "info").includes("Partial Superwall setup found in `Acme`."));
  assert.equal(runs.length, 1);
});

test("an account that can't be listed headless leaves the app unresolved without failing", async () => {
  useHome(API_KEY_SESSION);
  useFetch([{ match: "/v2/projects", status: 500, body: { message: "down" } }]);
  useAgents({ claude: [] });
  const app = expoApp(INTEGRATED, { "expo-superwall": "1.0.0" });
  const { calls, failed } = await integrate(app, {}, { interactive: false });
  assert.equal(failed, false, said(calls, "error").join());
  assert.deepEqual(steps(calls), ["Step 1 · Integrate the SDK"]);
});

test("a discovered app is named by its bundle ID when it has no name, and a failed lookup leaves it unresolved", async () => {
  useHome(API_KEY_SESSION);
  const projects = [{ id: 1, applications: [{ id: 10, bundle_id: "com.acme", public_api_key: KEY }] }];
  let listed = 0;
  useFetch([]);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("/v2/projects") && listed++ === 0) {
      return new Response(JSON.stringify(page(projects)), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "down" }), { status: 500, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  useAgents({ claude: [{ ok: true }] });
  const { calls, failed } = await integrate(expoApp(), {}, { interactive: false });
  assert.equal(failed, false, said(calls, "error").join());
  assert.ok(said(calls, "info").includes("Using app `com.acme`"));
  assert.deepEqual(steps(calls), ["Step 1 · Integrate the SDK"]);
});

test("review falls back to the next agent when the first runs out of usage", async () => {
  useHome();
  useFetch([]);
  const runs = useAgents({ claude: [{ ok: false, failureReason: "usage-limit" }], codex: [{ ok: true }] });
  const { calls } = await review(expoApp({}, { "expo-superwall": "1.0.0" }), false, { interactive: false });
  assert.deepEqual(runs.map((run) => run.driver), ["claude", "codex"]);
  assert.ok(said(calls, "info").includes("Partial Superwall setup found in `Acme`."));
});
