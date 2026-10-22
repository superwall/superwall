import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { resolveHostedAnthropicBaseUrl, selectHostedStatus } from "@/core/workflows/agent/hosted";
import { restoreFetch, useFetch } from "../../../helpers/fetch";
import { clearHomes, useHome } from "../../../helpers/home";

const signedIn = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
};

const status = { limit: 100, usage: 40, remaining: 60, exhausted: false, model: "claude-sonnet-5" };

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
});

test("the hosted Anthropic proxy lives on the signed-in host", () => {
  useHome({ host: "https://api.example.com" });

  assert.equal(resolveHostedAnthropicBaseUrl(), "https://api.example.com/v2/cli-agent/anthropic");
});

test("without a session host the proxy lives on the configured API host", () => {
  process.env.SUPERWALL_API_HOST = "https://api.staging.test";
  useHome();
  assert.equal(resolveHostedAnthropicBaseUrl(), "https://api.staging.test/v2/cli-agent/anthropic");

  useHome({ host: "" });
  assert.equal(resolveHostedAnthropicBaseUrl(), "https://api.staging.test/v2/cli-agent/anthropic");
});

test("the hosted status is read with the session's bearer token", async () => {
  useHome(signedIn);
  const seen: { url: string; headers: RequestInit["headers"] }[] = [];
  globalThis.fetch = async (input, init) => {
    seen.push({ url: String(input), headers: init?.headers });
    return Response.json(status);
  };

  assert.deepEqual(await selectHostedStatus(), status);
  assert.deepEqual(seen, [
    {
      url: "https://api.example.com/v2/cli-agent/status",
      headers: { authorization: "Bearer access-token", accept: "application/json" },
    },
  ]);
});

test("there is no hosted status without a browser login", async () => {
  useHome({ apiKey: "sk_key" });
  const log = useFetch([{ match: "cli-agent/status", body: status }]);

  assert.equal(await selectHostedStatus(), null);
  assert.deepEqual(log, []);
});

test("a refused or unreachable status endpoint is no status", async () => {
  useHome(signedIn);
  useFetch([{ match: "cli-agent/status", status: 503, body: { error: "down" } }]);
  assert.equal(await selectHostedStatus(), null);

  useFetch([{ match: "cli-agent/status", fail: true }]);
  assert.equal(await selectHostedStatus(), null);
});
