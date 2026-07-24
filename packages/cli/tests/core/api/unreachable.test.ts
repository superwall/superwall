import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiUnreachableError, SuperwallApi } from "@/core/api/client";

const originalFetch = globalThis.fetch;
const originalHost = process.env.SUPERWALL_API_HOST;

const session = {
  authMethod: "api_key" as const,
  apiKey: "sk_test",
  host: "https://api.superwall.com",
  createdAt: new Date().toISOString(),
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHost === undefined) delete process.env.SUPERWALL_API_HOST;
  else process.env.SUPERWALL_API_HOST = originalHost;
});

test("a dead local API says what to start instead of 'fetch failed'", async () => {
  process.env.SUPERWALL_API_HOST = "http://localhost:3001";
  globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));

  await assert.rejects(SuperwallApi.of(session).get("/v2/projects"), (error: Error) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.match(error.message, /http:\/\/localhost:3001/);
    assert.match(error.message, /start the API/);
    return true;
  });
});

test("an unreachable hosted API points at the network, not the server", async () => {
  delete process.env.SUPERWALL_API_HOST;
  globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));

  await assert.rejects(SuperwallApi.of(session).get("/v2/projects"), (error: Error) => {
    assert.match(error.message, /api\.superwall\.com/);
    assert.match(error.message, /network or proxy/);
    return true;
  });
});

test("HTTP failures still surface status and body", async () => {
  delete process.env.SUPERWALL_API_HOST;
  globalThis.fetch = () => Promise.resolve(new Response("nope", { status: 409 }));

  await assert.rejects(SuperwallApi.of(session).get("/v2/paywalls"), (error: Error) => {
    assert.match(error.message, /HTTP 409/);
    return true;
  });
});
