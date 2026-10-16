import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, createSuperwallApi } from "@/core/api/client";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

function respond(statuses: number[]): string[] {
  const methods: string[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? '{"ok":true}' : "busy", {
      status,
      headers: { "retry-after": "0" },
    });
  }) as typeof fetch;
  return methods;
}

test("a read that meets a busy API is retried until it lands", async () => {
  const methods = respond([503, 429, 200]);
  assert.deepEqual(await api().get("/v2/projects"), { ok: true });
  assert.equal(methods.length, 3);
});

test("a read gives up after a bounded number of retries and says why", async () => {
  const methods = respond([503, 503, 503, 503, 503]);
  await assert.rejects(
    api().get("/v2/projects"),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
  assert.equal(methods.length, 4);
});

test("a write is never retried, since it may already have landed", async () => {
  const methods = respond([503, 200]);
  await assert.rejects(api().post("/v2/paywalls", {}), ApiError);
  assert.deepEqual(methods, ["POST"]);
});

test("a client error is not retried", async () => {
  const methods = respond([404, 200]);
  await assert.rejects(api().get("/v2/projects/1"), ApiError);
  assert.equal(methods.length, 1);
});
