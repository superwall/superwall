import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { BROWSER_UNAVAILABLE } from "@/core/account/browser";
import { readSession, type Session } from "@/core/account/storage";
import { scanProject } from "@/core/codebase/scan";
import { readOnboardedApp } from "@/core/state/config";
import { createLoginGate, performLoginWithUi } from "@/core/workflows/login";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { answeringRenderer, prompted, said, type Answers } from "../../helpers/answers";
import { restoreFetch, useFetch, type Route } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import type { RendererCall } from "../../helpers/renderer";
import { API_HOST, clearLoginHosts, iosApp, loginRoutes, restoreSandboxPath, useLoginHosts, useSandboxPath } from "../../helpers/workflow";

beforeEach(() => {
  useHome();
  useLoginHosts();
  useSandboxPath();
  delete process.env.SUPERWALL_API_KEY;
});

afterEach(() => {
  restoreFetch();
  restoreSandboxPath();
  clearLoginHosts();
  clearHomes();
  selectRenderer({ mode: "text" });
  delete process.env.SUPERWALL_API_KEY;
});

function answering(answers: Answers = {}): RendererCall[] {
  const calls: RendererCall[] = [];
  useRenderer(answeringRenderer(answers, calls));
  return calls;
}

const detected = async () => {
  const app = (await scanProject(iosApp())).apps[0];
  assert.ok(app);
  return app;
};

test("a browser login says where to approve it, waits, and names who signed in", async () => {
  useFetch(loginRoutes());
  const calls = answering();
  const session = await performLoginWithUi();
  assert.equal(session?.userEmail, "ana@acme.dev");
  assert.equal(readSession()?.accessToken, "token-1");
  assert.deepEqual(said(calls, "info"), ["Approve this login in your browser · code `ABCD-EFGH`\nhttps://auth.test/device"]);
  assert.deepEqual(said(calls, "warn"), [BROWSER_UNAVAILABLE]);
  assert.deepEqual(said(calls, "spinner.start"), ["Waiting for you to approve in the browser"]);
  assert.deepEqual(said(calls, "spinner.stop"), ["Logged in as `ana@acme.dev`"]);
});

test("a login that fails stops the spinner and says why, returning no session", async () => {
  useFetch([{ match: "/.well-known/openid-configuration", status: 500, body: {} }]);
  const calls = answering();
  assert.equal(await performLoginWithUi(), null);
  assert.deepEqual(said(calls, "spinner.stop"), ["Login failed"]);
  assert.deepEqual(said(calls, "warn"), ["OIDC discovery failed (HTTP 500)."]);
});

test("a new account creates the detected app and remembers its key for this project", async () => {
  const app = await detected();
  const routes: Route[] = [
    {
      match: `${API_HOST}/internal/v2/onboarding/provision`,
      body: { project: { id: 70, organization_id: 9, applications: [{ id: 99, public_api_key: "pk_new_123456" }] } },
    },
    ...loginRoutes([]),
  ];
  useFetch(routes);
  const calls = answering({ confirm: [true], text: ["Acme Inc"] });
  const provisioned: unknown[] = [];
  const session = await performLoginWithUi(app, (result) => provisioned.push(result));
  assert.ok(session);
  assert.deepEqual(prompted(calls, "confirm"), ["Create `Acme` as your first app?"]);
  assert.deepEqual(said(calls, "spinner.start"), ["Waiting for you to approve in the browser", "Creating your account"]);
  assert.deepEqual(provisioned, [{ publicApiKey: "pk_new_123456", projectId: "70", applicationId: "99", orgId: "9" }]);
  assert.deepEqual(readOnboardedApp(app.path), { publicApiKey: "pk_new_123456", projectId: "70", applicationId: "99" });
});

test("a new account whose setup is dismissed is a failed login", async () => {
  useFetch(loginRoutes([]));
  const calls = answering({ confirm: [null] });
  assert.equal(await performLoginWithUi(await detected()), null);
  assert.deepEqual(said(calls, "warn").at(-1), "Cancelled.");
});

const SESSION: Session = { authMethod: "api_key", apiKey: "sk_live_x", host: API_HOST, createdAt: new Date().toISOString() };

test("the login gate passes a signed-in session straight through", async () => {
  const log = useFetch([]);
  const gate = createLoginGate(await detected(), { session: SESSION, interactive: true, dryRun: false });
  assert.equal(await gate.ensure(), true);
  assert.equal(gate.provisioned(), null);
  assert.deepEqual(log, []);
});

test("the login gate never logs in headless or on a dry run", async () => {
  const log = useFetch([]);
  const app = await detected();
  assert.equal(await createLoginGate(app, { session: null, interactive: false, dryRun: false }).ensure(), false);
  assert.equal(await createLoginGate(app, { session: null, interactive: true, dryRun: true }).ensure(), false);
  assert.deepEqual(log, []);
});

test("the login gate logs in once in a terminal, and keeps what onboarding created", async () => {
  useFetch([
    {
      match: `${API_HOST}/internal/v2/onboarding/provision`,
      body: { project: { id: 70, organization_id: 9, applications: [{ id: 99, public_api_key: "pk_new_123456" }] } },
    },
    ...loginRoutes([]),
  ]);
  answering({ confirm: [true], text: ["Acme Inc"] });
  const gate = createLoginGate(await detected(), { session: null, interactive: true, dryRun: false });
  assert.equal(await gate.ensure(), true);
  assert.equal(gate.provisioned()?.publicApiKey, "pk_new_123456");
  assert.equal(await gate.ensure(), true);
});

test("the login gate reports a failed login", async () => {
  useFetch([{ match: "/.well-known/openid-configuration", status: 500, body: {} }]);
  answering();
  const failing = createLoginGate(await detected(), { session: null, interactive: true, dryRun: false });
  assert.equal(await failing.ensure(), false);
});
