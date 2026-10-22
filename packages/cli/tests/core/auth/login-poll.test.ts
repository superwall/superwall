import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runLogin } from "@/commands/account/auth";
import { pollLogin, startLogin } from "@/core/auth/login";
import { loadSession } from "@/core/auth/storage";
import { run } from "../../helpers/command";

const realFetch = globalThis.fetch;
const realHome = process.env.SUPERWALL_HOME;

beforeEach(() => {
  process.env.SUPERWALL_HOME = mkdtempSync(join(tmpdir(), "superwall-login-poll-"));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.SUPERWALL_HOME = realHome;
  process.exitCode = undefined;
});

const pendingFile = () => join(process.env.SUPERWALL_HOME!, "pending-login.json");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Auth {
  approved: boolean;
  tokenError?: string;
  orgs: Array<{ id: number; name: string }>;
  created: string[];
}

function fakeAuth(auth: Auth) {
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
      if (body.get("grant_type") === "refresh_token") return json({ access_token: "token-2" });
      if (auth.tokenError) return json({ error: auth.tokenError }, 400);
      return auth.approved
        ? json({ access_token: "token-1", refresh_token: "refresh-1", expires_in: 300 })
        : json({ error: "authorization_pending" }, 400);
    }
    if (url.endsWith("/v2/me")) return json({ email: "new@example.com" });
    if (url.endsWith("/v2/me/organizations") && init?.method === "POST") {
      const { name } = JSON.parse(String(init.body)) as { name: string };
      auth.created.push(name);
      return json({ id: 9, name });
    }
    if (url.endsWith("/v2/me/organizations")) return json({ data: auth.orgs });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

const noBrowser = async () => false;

test("start saves the pending login and returns at once; poll waits, then logs in", async () => {
  const auth: Auth = { approved: false, orgs: [{ id: 7, name: "Acme" }], created: [] };
  fakeAuth(auth);

  const started = await startLogin({ apiHost: "https://api.test", openBrowser: noBrowser });
  assert.equal(started.pending.userCode, "ABCD-EFGH");
  assert.equal(started.pending.url, "https://auth.test/device?user_code=ABCD-EFGH");
  assert.equal(existsSync(pendingFile()), true);

  const waiting = await pollLogin({ timeoutMs: 20 });
  assert.equal(waiting.status, "pending");
  assert.equal(existsSync(pendingFile()), true);
  assert.equal(loadSession(), null);

  auth.approved = true;
  const done = await pollLogin({ timeoutMs: 1000 });
  assert.equal(done.status, "logged_in");
  assert.equal(existsSync(pendingFile()), false);
  assert.equal(loadSession()?.orgName, "Acme");
  assert.equal(loadSession()?.userEmail, "new@example.com");
});

test("a new account without an organization keeps its approval until --org-name is given", async () => {
  const auth: Auth = { approved: true, orgs: [], created: [] };
  fakeAuth(auth);
  await startLogin({ apiHost: "https://api.test", openBrowser: noBrowser });

  const needs = await pollLogin({ timeoutMs: 1000 });
  assert.equal(needs.status, "needs_organization");
  assert.equal(existsSync(pendingFile()), true);
  assert.equal(loadSession(), null);

  auth.approved = false;
  const done = await pollLogin({ timeoutMs: 1000, orgName: "Acme" });
  assert.equal(done.status, "logged_in");
  assert.deepEqual(auth.created, ["Acme"]);
  assert.equal(loadSession()?.orgName, "Acme");
  assert.equal(existsSync(pendingFile()), false);
});

test("an organization name given at the start is used once the login is approved", async () => {
  const auth: Auth = { approved: true, orgs: [], created: [] };
  fakeAuth(auth);
  await startLogin({ apiHost: "https://api.test", openBrowser: noBrowser, orgName: "Acme" });
  const done = await pollLogin({ timeoutMs: 1000 });
  assert.equal(done.status, "logged_in");
  assert.deepEqual(auth.created, ["Acme"]);
});

test("polling with nothing started, a denied login, or an expired code says so", async () => {
  await assert.rejects(pollLogin({ timeoutMs: 10 }), /No login in progress/);

  const auth: Auth = { approved: false, tokenError: "access_denied", orgs: [], created: [] };
  fakeAuth(auth);
  await startLogin({ apiHost: "https://api.test", openBrowser: noBrowser });
  await assert.rejects(pollLogin({ timeoutMs: 1000 }), /Login was denied/);
  assert.equal(existsSync(pendingFile()), false);

  auth.tokenError = "expired_token";
  await startLogin({ apiHost: "https://api.test", openBrowser: noBrowser });
  await assert.rejects(pollLogin({ timeoutMs: 1000 }), /expired/);
  assert.equal(existsSync(pendingFile()), false);
});

test("without a terminal, login prints the link and returns; --poll finishes it", async () => {
  const auth: Auth = { approved: false, orgs: [{ id: 7, name: "Acme" }], created: [] };
  fakeAuth(auth);
  process.env.SUPERWALL_API_HOST = "https://api.test";
  process.env.BROWSER = "none";
  try {
    const started = await run(runLogin.definition, {
      argv: { json: true, host: "https://auth.test" },
    });
    assert.deepEqual(
      { ...(started.json as Record<string, unknown>), expires_at: undefined },
      {
        status: "pending",
        verification_url: "https://auth.test/device?user_code=ABCD-EFGH",
        user_code: "ABCD-EFGH",
        expires_at: undefined,
        browser_opened: false,
        next: "superwall login --poll",
      },
    );

    const waiting = await run(runLogin.definition, { argv: { json: true, poll: true, timeout: 0 } });
    assert.equal((waiting.json as { status: string }).status, "pending");
    assert.equal(process.exitCode, 1);

    process.exitCode = undefined;
    auth.approved = true;
    const done = await run(runLogin.definition, { argv: { json: true, poll: true, timeout: 1 } });
    assert.equal((done.json as { status: string }).status, "logged_in");
    assert.equal(process.exitCode, undefined);
  } finally {
    delete process.env.SUPERWALL_API_HOST;
    delete process.env.BROWSER;
  }
});
