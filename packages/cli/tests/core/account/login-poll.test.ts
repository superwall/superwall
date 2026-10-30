import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { pollLogin, startLogin } from "@/core/account/login";
import { readPendingLogin, readSession, writePendingLogin } from "@/core/account/storage";
import { clearHomes, useHome } from "../../helpers/home";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  clearHomes();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Auth {
  approved: boolean;
  tokenError?: string;
  refreshFails?: boolean;
  orgs: Array<{ id: number; name: string }>;
  created: string[];
  refreshed: number;
  refreshedWith: string[];
}

const auth = (overrides: Partial<Auth> = {}): Auth => ({
  approved: false,
  orgs: [],
  created: [],
  refreshed: 0,
  refreshedWith: [],
  ...overrides,
});

function fakeAuth(state: Auth): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return json({
        token_endpoint: "https://auth.test/oauth2/token",
        device_authorization_endpoint: "https://auth.test/oauth2/device_authorization",
      });
    }
    if (url.endsWith("/device_authorization")) {
      return json({
        device_code: "device-1",
        user_code: "ABCD-EFGH",
        verification_uri: "https://auth.test/device",
        verification_uri_complete: "https://auth.test/device?user_code=ABCD-EFGH",
        interval: 0,
        expires_in: 300,
      });
    }
    if (url.endsWith("/oauth2/token")) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      if (body.get("grant_type") === "refresh_token") {
        state.refreshed++;
        state.refreshedWith.push(body.get("refresh_token") ?? "");
        if (state.refreshFails) return json({ error: "invalid_grant" }, 400);
        return json({ access_token: `token-${state.refreshed + 1}`, refresh_token: `refresh-${state.refreshed + 1}`, expires_in: 900 });
      }
      if (state.tokenError) return json({ error: state.tokenError }, 400);
      return state.approved
        ? json({ access_token: "token-1", refresh_token: "refresh-1", expires_in: 300 })
        : json({ error: "authorization_pending" }, 400);
    }
    if (url.endsWith("/v2/me")) return json({ email: "new@example.com" });
    if (url.endsWith("/v2/me/organizations") && init?.method === "POST") {
      const { name } = JSON.parse(String(init.body)) as { name: string };
      state.created.push(name);
      return json({ id: 9, name });
    }
    if (url.endsWith("/v2/me/organizations")) return json({ data: state.orgs });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

const noBrowser = async () => false;
const start = (options: Parameters<typeof startLogin>[0] = {}) =>
  startLogin({ issuer: "https://auth.test", apiHost: "https://api.test", openBrowser: noBrowser, ...options });

test("start saves the pending login and returns at once; poll waits, then logs in", async () => {
  const home = useHome();
  const state = auth({ orgs: [{ id: 7, name: "Acme" }] });
  fakeAuth(state);

  const started = await start();
  assert.equal(started.pending.userCode, "ABCD-EFGH");
  assert.equal(started.pending.url, "https://auth.test/device?user_code=ABCD-EFGH");
  assert.equal(started.browserOpened, false);
  const file = path.join(home, "pending-login.json");
  assert.equal(fs.existsSync(file), true);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const waiting = await pollLogin({ timeoutMs: 20 });
  assert.equal(waiting.status, "pending");
  assert.notEqual(readPendingLogin(), null);
  assert.equal(readSession(), null);

  state.approved = true;
  const done = await pollLogin({ timeoutMs: 1000 });
  assert.equal(done.status, "logged_in");
  assert.equal(readPendingLogin(), null);
  assert.equal(readSession()?.userEmail, "new@example.com");
  assert.equal(readSession()?.accessToken, "token-1");
});

test("a new account without an organization keeps its approval until --org-name is given", async () => {
  useHome();
  const state = auth({ approved: true });
  fakeAuth(state);
  await start();

  const needs = await pollLogin({ timeoutMs: 1000 });
  assert.equal(needs.status, "needs_organization");
  assert.equal(readPendingLogin()?.tokens?.accessToken, "token-1");
  assert.equal(readSession(), null);

  state.approved = false;
  const done = await pollLogin({ timeoutMs: 1000, orgName: "Acme" });
  assert.equal(done.status, "logged_in");
  assert.deepEqual(state.created, ["Acme"]);
  assert.equal(readPendingLogin(), null);
  assert.deepEqual(state.refreshedWith, ["refresh-1", "refresh-2"]);
  const session = readSession();
  assert.equal(session?.accessToken, "token-3");
  assert.equal(session?.refreshToken, "refresh-3");
  assert.ok((session?.accessTokenExpiresAt ?? 0) > Date.now() + 890_000);
});

test("an organization name given at the start is used once the login is approved", async () => {
  useHome();
  const state = auth({ approved: true });
  fakeAuth(state);
  await start({ orgName: "Acme" });
  assert.equal(readPendingLogin()?.orgName, "Acme");

  const done = await pollLogin({ timeoutMs: 1000 });
  assert.equal(done.status, "logged_in");
  assert.deepEqual(state.created, ["Acme"]);
});

test("kept tokens without a refresh token, or whose refresh fails, are used as they are", async () => {
  useHome();
  const state = auth({ approved: true, refreshFails: true });
  fakeAuth(state);
  await start();
  assert.equal((await pollLogin({ timeoutMs: 1000 })).status, "needs_organization");

  const kept = readPendingLogin();
  assert.ok(kept?.tokens);
  writePendingLogin({ ...kept, tokens: { accessToken: "token-1" } });
  assert.equal((await pollLogin({ timeoutMs: 1000 })).status, "needs_organization");
  assert.equal(state.refreshed, 0);

  writePendingLogin({ ...kept, tokens: { accessToken: "token-1", refreshToken: "refresh-1" } });
  state.orgs = [{ id: 7, name: "Acme" }];
  const done = await pollLogin({ timeoutMs: 1000 });
  assert.equal(done.status, "logged_in");
  assert.equal(state.refreshed, 1);
  assert.equal(readSession()?.accessToken, "token-1");
});

test("polling with nothing started, a denied login, or an expired code says so", async () => {
  useHome();
  await assert.rejects(pollLogin({ timeoutMs: 10 }), /No login in progress/);

  const state = auth({ tokenError: "access_denied" });
  fakeAuth(state);
  await start();
  await assert.rejects(pollLogin({ timeoutMs: 1000 }), /Login was denied/);
  assert.equal(readPendingLogin(), null);

  state.tokenError = "expired_token";
  await start();
  await assert.rejects(pollLogin({ timeoutMs: 1000 }), /expired/);
  assert.equal(readPendingLogin(), null);
});

test("a code past its expiry is refused before polling and cleared", async () => {
  useHome();
  const state = auth({ approved: true });
  fakeAuth(state);
  const { pending } = await start();
  writePendingLogin({ ...pending, expiresAt: Date.now() - 1 });

  await assert.rejects(pollLogin({ timeoutMs: 1000 }), /expired\. Run `superwall login` again for a new code/);
  assert.equal(readPendingLogin(), null);
});

test("a poll whose timeout ends before the next allowed request returns pending without asking", async () => {
  useHome();
  const state = auth({ approved: true });
  fakeAuth(state);
  const { pending } = await start();
  writePendingLogin({ ...pending, interval: 30, lastPolledAt: Date.now() });

  const result = await pollLogin({ timeoutMs: 50 });
  assert.equal(result.status, "pending");
  assert.equal(readSession(), null);
  assert.equal(readPendingLogin()?.interval, 30);
});
