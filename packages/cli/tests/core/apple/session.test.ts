import assert from "node:assert/strict";
import { test } from "node:test";
import { AppleError, createAppleSession } from "@/core/apple/session";
import { fakeApple, fixedRandom, jsonResponse, vector } from "../../helpers/apple";

const now = () => new Date(Date.UTC(2026, 9, 8));

function start(options: Parameters<typeof fakeApple>[0] = {}) {
  const apple = fakeApple(options);
  const session = createAppleSession({ fetch: apple.fetch, random: fixedRandom, now });
  return { apple, session };
}

const signIn = (session: ReturnType<typeof createAppleSession>) =>
  session.signIn(` ${vector.accountName} `, vector.password);

test("signs in with a trusted-device code and reads the team", async () => {
  const { apple, session } = start();
  assert.equal(await signIn(session), "verification-required");

  const complete = apple.called("POST", "/signin/complete")[0]!;
  assert.equal(complete.headers.get("x-apple-widget-key"), "widget");
  assert.match(complete.headers.get("x-apple-hc") ?? "", /^1:8:20261008000000:hc-challenge::\d+$/);
  assert.deepEqual(complete.body, {
    accountName: vector.accountName,
    c: "challenge-token",
    m1: vector.m1,
    m2: (complete.body as { m2: string }).m2,
    rememberMe: false,
  });

  assert.deepEqual(await session.requestCode(), { method: "device", codeLength: 6 });
  assert.equal(apple.called("PUT", "/verify/phone").length, 0);

  await session.submitCode(" 123456 ");
  const verify = apple.called("POST", "/verify/trusteddevice/securitycode")[0]!;
  assert.equal(verify.headers.get("x-apple-id-session-id"), "session-1");
  assert.equal(verify.headers.get("scnt"), "scnt-1");
  assert.deepEqual(verify.body, { securityCode: { code: "123456" } });
  assert.equal(apple.called("GET", "/2sv/trust").length, 1);
  assert.deepEqual(session.team(), { id: 111, issuerId: "issuer-111", name: "Acme Inc" });
  assert.deepEqual(session.teams(), [session.team()]);
});

test("texts the code when asked, and verifies through the phone endpoint", async () => {
  const { apple, session } = start({
    phones: [
      { id: 1, pushMode: "sms", numberWithDialCode: "+1 (•••) •••-••42" },
      { id: 2, pushMode: "voice", numberWithDialCode: "+44 •••• ••••17" },
    ],
  });
  await signIn(session);
  assert.deepEqual(await session.requestCode({ sms: true }), {
    method: "sms",
    destination: "+1 (•••) •••-••42",
    codeLength: 6,
  });
  assert.deepEqual(apple.called("PUT", "/verify/phone")[0]?.body, {
    phoneNumber: { id: 1 },
    mode: "sms",
  });

  assert.deepEqual(await session.requestCode({ phone: "+44 7700 900117" }), {
    method: "voice",
    destination: "+44 •••• ••••17",
    codeLength: 6,
  });
  await assert.rejects(session.requestCode({ phone: "+1 555 000 0000" }), /No trusted phone number/);

  await session.submitCode("123456");
  assert.deepEqual(apple.called("POST", "/verify/phone/securitycode")[0]?.body, {
    securityCode: { code: "123456" },
    phoneNumber: { id: 2 },
    mode: "voice",
  });
});

test("an account with no trusted device falls back to its only phone without re-sending", async () => {
  const { apple, session } = start({ noTrustedDevices: true });
  await signIn(session);
  assert.equal((await session.requestCode()).method, "sms");
  assert.equal(apple.called("PUT", "/verify/phone").length, 0);
});

test("an account with no trusted phone cannot get a text", async () => {
  const { session } = start({ phones: [] });
  await signIn(session);
  await assert.rejects(session.requestCode({ sms: true }), /no trusted phone number/);
});

test("a wrong code is a verification error that can be retried", async () => {
  const { session } = start();
  await signIn(session);
  await session.requestCode();
  await assert.rejects(session.submitCode("000000"), (error) => {
    assert.ok(error instanceof AppleError);
    assert.equal(error.kind, "verification");
    assert.equal(error.message, "Incorrect verification code. (-21669)");
    return true;
  });
  await session.submitCode("123456");
  assert.equal(session.team().id, 111);
});

test("a pending verification resumes in a new session", async () => {
  const { apple, session } = start();
  await signIn(session);
  await session.requestCode({ sms: true });
  const pending = session.pending();
  assert.equal(pending.appleId, vector.accountName);
  assert.equal(pending.sessionId, "session-1");

  const resumed = createAppleSession({ fetch: apple.fetch, pending });
  await resumed.submitCode("123456");
  assert.equal(apple.called("POST", "/verify/phone/securitycode").length, 1);
  assert.equal(resumed.team().name, "Acme Inc");
});

test("an account without two-factor signs straight in", async () => {
  const { session } = start({ twoFactor: false });
  assert.equal(await signIn(session), "signed-in");
  assert.equal(session.team().id, 111);
});

test("a wrong password is a credentials error", async () => {
  const { session } = start();
  await assert.rejects(session.signIn(vector.accountName, "wrong"), (error) => {
    assert.ok(error instanceof AppleError);
    assert.equal(error.kind, "credentials");
    return true;
  });
});

test("an unknown account is a credentials error", async () => {
  const { session } = start({
    routes: (call) =>
      call.url.endsWith("/signin/init") ? jsonResponse({}, { status: 401 }) : undefined,
  });
  await assert.rejects(signIn(session), /Incorrect Apple Account email or password/);
});

test("a pending account prompt is reported as something to finish at Apple", async () => {
  const { session } = start({ completeStatus: 412 });
  await assert.rejects(signIn(session), (error) => {
    assert.ok(error instanceof AppleError);
    assert.equal(error.kind, "account-action");
    return true;
  });
});

test("other sign-in failures carry Apple's message", async () => {
  const init = start({
    routes: (call) =>
      call.url.endsWith("/signin/init")
        ? jsonResponse({ serviceErrors: [{ message: "Try later" }] }, { status: 503 })
        : undefined,
  });
  await assert.rejects(signIn(init.session), /Apple sign-in failed: Try later/);

  const complete = start({ completeStatus: 500 });
  await assert.rejects(signIn(complete.session), /Apple sign-in failed: HTTP 500/);

  const config = start({
    routes: (call) => (call.url.endsWith("/logout") ? jsonResponse({}) : undefined),
  });
  await assert.rejects(signIn(config.session), /sign-in configuration/);
});

test("the sign-in key is read from the signout redirect without following it", async () => {
  const { apple, session } = start();
  await signIn(session);
  const logout = apple.called("HEAD", "/logout");
  assert.equal(logout.length, 1);
  assert.equal(logout[0]?.headers.get("cookie"), null);
  assert.equal(apple.calls.some((call) => call.url.includes("/appleauth/signout")), false);
});

test("a network failure before sign-in is reported as Apple being unreachable", async () => {
  const session = createAppleSession({
    fetch: (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch,
  });
  await assert.rejects(session.signIn("jane@example.com", "x"), /Couldn't reach Apple/);
});

test("hashcash is skipped when Apple sends no challenge", async () => {
  const { apple, session } = start({
    routes: (call) =>
      call.method === "GET" && call.url.includes("/signin?widgetKey")
        ? new Response("", { status: 200 })
        : undefined,
  });
  await signIn(session);
  assert.equal(apple.called("POST", "/signin/complete")[0]?.headers.get("x-apple-hc"), null);
});

test("an account with no App Store Connect team is refused clearly", async () => {
  const { session } = start({
    twoFactor: false,
    routes: (call) =>
      call.method === "GET" && call.url.endsWith("/olympus/v1/session")
        ? jsonResponse({ user: { emailAddress: "jane@example.com" } })
        : undefined,
  });
  await assert.rejects(signIn(session), /no App Store Connect team/);
});

test("a rejected App Store Connect session is a forbidden error", async () => {
  const { session } = start({
    twoFactor: false,
    routes: (call) =>
      call.method === "GET" && call.url.endsWith("/olympus/v1/session")
        ? jsonResponse({ errors: [{ title: "Forbidden" }] }, { status: 403 })
        : undefined,
  });
  await assert.rejects(signIn(session), (error) => {
    assert.ok(error instanceof AppleError);
    assert.equal(error.kind, "forbidden");
    assert.match(error.message, /Forbidden/);
    return true;
  });
});

test("switches team and refuses one the account is not on", async () => {
  const teams = [
    { providerId: 111, publicProviderId: "issuer-111", name: "Acme Inc" },
    { providerId: 222, publicProviderId: "issuer-222", name: "Side Project" },
  ];
  const { apple, session } = start({ twoFactor: false, teams });
  await signIn(session);
  await session.selectTeam(111);
  assert.equal(apple.called("POST", "/olympus/v1/session").length, 0);
  await session.selectTeam(222);
  assert.deepEqual(apple.called("POST", "/olympus/v1/session")[0]?.body, {
    provider: { providerId: 222 },
  });
  assert.equal(session.team().issuerId, "issuer-222");
  await assert.rejects(session.selectTeam(999), /isn't on team 999/);
});

test("a team switch Apple ignores or rejects is an error", async () => {
  const teams = [
    { providerId: 111, name: "Acme Inc" },
    { providerId: 222, name: "Side Project" },
  ];
  const ignored = start({
    twoFactor: false,
    teams,
    routes: (call) =>
      call.method === "POST" && call.url.endsWith("/olympus/v1/session")
        ? new Response(null, { status: 200 })
        : undefined,
  });
  await signIn(ignored.session);
  await assert.rejects(ignored.session.selectTeam(222), /didn't switch to team 222/);

  const rejected = start({
    twoFactor: false,
    teams,
    routes: (call) =>
      call.method === "POST" && call.url.endsWith("/olympus/v1/session")
        ? jsonResponse({ errors: [{ detail: "Nope" }] }, { status: 500 })
        : undefined,
  });
  await signIn(rejected.session);
  await assert.rejects(rejected.session.selectTeam(222), /Couldn't switch Apple team: Nope/);
});

test("iris requests carry the web app's headers, cookies and query", async () => {
  const { apple, session } = start({
    twoFactor: false,
    iris: () => jsonResponse({ data: [{ id: "K1" }] }),
  });
  await signIn(session);
  const result = await session.iris("GET", "/apiKeys", { query: { limit: "1" } });
  assert.deepEqual(result, { data: [{ id: "K1" }] });
  const call = apple.called("GET", "/iris/v1/apiKeys")[0]!;
  assert.equal(call.url, "https://appstoreconnect.apple.com/iris/v1/apiKeys?limit=1");
  assert.equal(call.headers.get("x-csrf-itc"), "[asc-ui]");
  assert.equal(call.headers.get("origin"), "https://appstoreconnect.apple.com");
  assert.equal(call.headers.get("cookie"), "myacinfo=ok");
});

test("iris failures are forbidden or request errors with Apple's detail", async () => {
  const forbidden = start({
    twoFactor: false,
    iris: () => jsonResponse({ errors: [{ detail: "does not allow this request" }] }, { status: 403 }),
  });
  await signIn(forbidden.session);
  await assert.rejects(forbidden.session.iris("POST", "/apiKeys", { body: {} }), (error) => {
    assert.ok(error instanceof AppleError);
    assert.equal(error.kind, "forbidden");
    assert.equal(error.status, 403);
    assert.equal(error.message, "does not allow this request");
    return true;
  });

  const conflict = start({
    twoFactor: false,
    iris: () => jsonResponse({ errors: [{ title: "Conflict" }] }, { status: 409 }),
  });
  await signIn(conflict.session);
  await assert.rejects(conflict.session.iris("POST", "/apiKeys"), (error) => {
    assert.ok(error instanceof AppleError);
    assert.equal(error.kind, "request");
    assert.equal(error.message, "Conflict");
    return true;
  });
});

test("verification steps need a sign-in to continue from", async () => {
  const session = createAppleSession({ fetch: fakeApple().fetch });
  await assert.rejects(session.requestCode(), /sign-in expired/);
  await assert.rejects(session.submitCode("1"), /sign-in expired/);
  assert.throws(() => session.pending(), /sign-in expired/);
  assert.throws(() => session.team(), /Sign in to Apple first/);
});
