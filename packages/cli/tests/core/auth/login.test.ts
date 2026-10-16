import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { afterEach, test } from "node:test";
import { openBrowser } from "@/core/auth/browser";
import { performLogin } from "@/core/auth/login";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("a browser that can't be opened leaves the login polling until it is approved", async () => {
  let polls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
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
      polls++;
      return polls < 3
        ? json({ error: "authorization_pending" }, 400)
        : json({ access_token: "token-1", expires_in: 300 });
    }
    if (url.endsWith("/v2/me")) return json({ email: "new@example.com" });
    if (url.endsWith("/v2/me/organizations")) return json({ data: [{ id: 7, name: "Acme" }] });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;

  const verified: Array<{ url: string; userCode: string; browserOpened: boolean }> = [];
  const session = await performLogin({
    issuer: "https://auth.test",
    apiHost: "https://api.test",
    clientId: "client_test",
    openBrowser: (url) =>
      openBrowser(url, {
        platform: "linux",
        env: { DISPLAY: ":0" },
        spawn: ((_cmd: string, args: string[], options: object) =>
          spawn("superwall-test-no-such-browser", args, options)) as typeof spawn,
      }),
    onVerify: (info) => verified.push(info),
  });

  assert.deepEqual(verified, [
    {
      url: "https://auth.test/device?user_code=ABCD-EFGH",
      userCode: "ABCD-EFGH",
      browserOpened: false,
    },
  ]);
  assert.equal(polls, 3);
  assert.equal(session.accessToken, "token-1");
  assert.equal(session.userEmail, "new@example.com");
  assert.equal(session.orgName, "Acme");
});
