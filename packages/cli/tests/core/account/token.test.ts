import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  LoginUnreachableError,
  NotLoggedInError,
  getOAuthAccessToken,
  resolveAuthToken,
} from "@/core/account/token";
import { readSession, type Session } from "@/core/account/storage";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  restoreFetch();
  clearHomes();
});

const TOKEN_ENDPOINT = "https://auth.test/oauth2/token";

const oauth = (overrides: Partial<Session> = {}): Session => ({
  authMethod: "oauth",
  host: "https://api.example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  accessToken: "at_old",
  refreshToken: "rt_old",
  accessTokenExpiresAt: Date.now() - 1000,
  tokenEndpoint: TOKEN_ENDPOINT,
  oauthClientId: "client_test",
  ...overrides,
});

test("no session, or an API key session, has no OAuth token", async () => {
  useHome();
  assert.equal(await getOAuthAccessToken(), null);

  useHome({ authMethod: "api_key", apiKey: "sk_1" });
  assert.equal(await getOAuthAccessToken(), null);
});

test("a fresh access token is returned without a refresh", async () => {
  useHome(oauth({ accessTokenExpiresAt: Date.now() + 10 * 60_000 }));
  const log = useFetch([]);

  assert.equal(await getOAuthAccessToken(), "at_old");
  assert.equal(log.length, 0);
});

test("a token inside the expiry skew is refreshed and the new one is kept", async () => {
  useHome(oauth({ accessTokenExpiresAt: Date.now() + 30_000 }));
  const log = useFetch([
    {
      match: TOKEN_ENDPOINT,
      body: { access_token: "at_new", refresh_token: "rt_new", expires_in: 3600 },
    },
  ]);

  assert.equal(await getOAuthAccessToken(), "at_new");

  assert.equal(log[0]?.method, "POST");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(log[0]?.body)), {
    grant_type: "refresh_token",
    refresh_token: "rt_old",
    client_id: "client_test",
  });
  const saved = readSession();
  assert.equal(saved?.accessToken, "at_new");
  assert.equal(saved?.refreshToken, "rt_new");
  assert.ok((saved?.accessTokenExpiresAt ?? 0) > Date.now() + 3500_000);
});

test("a refresh that rotates nothing keeps the refresh token and drops the expiry", async () => {
  useHome(oauth({ accessTokenExpiresAt: undefined }));
  useFetch([{ match: TOKEN_ENDPOINT, body: { access_token: "at_new" } }]);

  assert.equal(await getOAuthAccessToken(), "at_new");

  const saved = readSession();
  assert.equal(saved?.refreshToken, "rt_old");
  assert.equal(saved?.accessTokenExpiresAt, undefined);
});

test("a refresh that fails, answers without a token, or can't connect gives no token", async () => {
  for (const route of [
    { match: TOKEN_ENDPOINT, status: 400, body: { error: "invalid_grant" } },
    { match: TOKEN_ENDPOINT, body: { token_type: "Bearer" } },
    { match: TOKEN_ENDPOINT, text: "<html>bad gateway</html>" },
    { match: TOKEN_ENDPOINT, fail: true },
    { match: TOKEN_ENDPOINT, stall: true },
    { match: TOKEN_ENDPOINT, stallBody: true },
  ]) {
    useHome(oauth());
    useFetch([route]);

    assert.equal(await getOAuthAccessToken({ timeoutMs: 20 }), null);
    assert.equal(readSession()?.accessToken, "at_old");
  }
});

test("a session missing what a refresh needs is never refreshed", async () => {
  useHome(oauth({ tokenEndpoint: undefined }));
  const log = useFetch([]);

  assert.equal(await getOAuthAccessToken(), null);
  assert.equal(log.length, 0);
});

test("the auth token is the fresh OAuth token with the session unchanged", async () => {
  const session = oauth({ accessTokenExpiresAt: Date.now() + 10 * 60_000, apiKey: "sk_1" });

  assert.deepEqual(await resolveAuthToken(session), { token: "at_old", session });
});

test("an expired OAuth token is refreshed and the refreshed session is handed back", async () => {
  useHome();
  useFetch([{ match: TOKEN_ENDPOINT, body: { access_token: "at_new", expires_in: 60 } }]);

  const resolved = await resolveAuthToken(oauth());

  assert.equal(resolved.token, "at_new");
  assert.equal(resolved.session.accessToken, "at_new");
  assert.equal(readSession()?.accessToken, "at_new");
});

test("an OAuth session that can't refresh falls back to its API key", async () => {
  useHome();
  useFetch([{ match: TOKEN_ENDPOINT, status: 401 }]);
  const session = oauth({ apiKey: "sk_1" });

  assert.deepEqual(await resolveAuthToken(session), { token: "sk_1", session });
});

test("an API key session uses the key, and a session with neither is not logged in", async () => {
  const keyed: Session = { host: "https://h", createdAt: "n", apiKey: "sk_1", accessToken: "at_1" };

  assert.deepEqual(await resolveAuthToken(keyed), { token: "sk_1", session: keyed });
  await assert.rejects(
    resolveAuthToken({ host: "https://h", createdAt: "n", accessToken: "at_1" }),
    (error: unknown) => error instanceof NotLoggedInError && /superwall login/.test(error.message),
  );
});

test("a refresh that can't connect says the login service is unreachable, not that you're logged out", async () => {
  useHome();
  useFetch([{ match: TOKEN_ENDPOINT, fail: true }]);

  await assert.rejects(resolveAuthToken(oauth()), (error: unknown) => {
    assert.ok(error instanceof LoginUnreachableError);
    assert.equal(error.timedOut, false);
    assert.equal(
      error.message,
      "Couldn't reach the Superwall login service at https://auth.test to refresh your session.\n  Check your network or proxy, then try again.",
    );
    return true;
  });
  assert.equal(readSession(), null);
});

test("a refresh that never answers gives up at its deadline", async () => {
  useHome();
  const log = useFetch([{ match: TOKEN_ENDPOINT, stall: true }]);
  const started = Date.now();

  await assert.rejects(resolveAuthToken(oauth(), { timeoutMs: 20 }), (error: unknown) => {
    assert.ok(error instanceof LoginUnreachableError);
    assert.equal(error.timedOut, true);
    assert.equal(
      error.message,
      "The Superwall login service at https://auth.test didn't answer within 0.02s, so your session wasn't refreshed.\n  Try again.",
    );
    return true;
  });
  assert.equal(log.length, 1);
  assert.ok(Date.now() - started < 2_000);
});

test("a refresh whose answer stalls after its headers is the same timeout, not a logout", async () => {
  useHome();
  const log = useFetch([{ match: TOKEN_ENDPOINT, stallBody: true }]);
  const started = Date.now();

  await assert.rejects(resolveAuthToken(oauth(), { timeoutMs: 20 }), (error: unknown) => {
    assert.ok(error instanceof LoginUnreachableError);
    assert.equal(error.timedOut, true);
    return true;
  });
  assert.equal(log.length, 1);
  assert.ok(Date.now() - started < 2_000);
});

test("an unreachable refresh still falls back to the session's API key", async () => {
  useHome();
  const session = oauth({ apiKey: "sk_1" });
  for (const route of [
    { match: TOKEN_ENDPOINT, fail: true },
    { match: TOKEN_ENDPOINT, stall: true },
  ]) {
    useFetch([route]);
    assert.deepEqual(await resolveAuthToken(session, { timeoutMs: 20 }), {
      token: "sk_1",
      session,
    });
  }
});
