import { test } from "node:test";
import assert from "node:assert/strict";
import { SuperwallApi, ApiError } from "@/core/api/client";
import type { Session } from "@/core/auth/storage";

const SESSION: Session = {
  apiKey: "sk_test123",
  orgId: "1",
  orgName: "Acme",
  host: "https://api.example.com",
  createdAt: "now",
};

interface Call {
  url: string;
  init: RequestInit;
}

/** Replace global fetch with a scripted responder; returns the recorded calls. */
function mockFetch(
  responder: (url: string, init: RequestInit) => { status?: number; body?: unknown },
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, body = {} } = responder(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
    });
  }) as typeof fetch;
  return calls;
}

function mockTextFetch(
  responder: (url: string, init: RequestInit) => { status?: number; body?: string },
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, body = "" } = responder(url, init);
    return new Response(body, { status });
  }) as typeof fetch;
  return calls;
}

test("get() sends Bearer auth to the session host and parses JSON", async () => {
  const calls = mockFetch(() => ({ body: { ok: true } }));
  const api = SuperwallApi.of(SESSION);
  const res = await api.get<{ ok: boolean }>("/v2/thing");
  assert.equal(res.ok, true);
  assert.equal(calls[0]!.url, "https://api.example.com/v2/thing");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>).authorization,
    "Bearer sk_test123",
  );
});

test("non-2xx throws ApiError with status + body", async () => {
  mockFetch(() => ({ status: 400, body: { message: "bad" } }));
  const api = SuperwallApi.of(SESSION);
  await assert.rejects(
    () => api.get("/v2/x"),
    (e: unknown) => e instanceof ApiError && (e as ApiError).status === 400,
  );
});

test("list() paginates via has_more + starting_after", async () => {
  const calls = mockFetch((url) => {
    if (url.includes("starting_after=2")) return { body: { data: [{ id: 3 }], has_more: false } };
    return { body: { data: [{ id: 1 }, { id: 2 }], has_more: true } };
  });
  const api = SuperwallApi.of(SESSION);
  const rows = await api.list<{ id: number }>("/v2/products?project_id=9");
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 2, 3],
  );
  // second page carries the scope + cursor
  assert.match(calls[1]!.url, /project_id=9/);
  assert.match(calls[1]!.url, /starting_after=2/);
});

test("postText() sends a raw text body and returns the raw response", async () => {
  const calls = mockTextFetch(() => ({ body: "ok\t1\n" }));
  const api = SuperwallApi.of(SESSION);
  const res = await api.postText("/v2/organizations/1/query?default_format=JSON", "SELECT 1");

  assert.equal(res, "ok\t1\n");
  assert.equal(
    calls[0]!.url,
    "https://api.example.com/v2/organizations/1/query?default_format=JSON",
  );
  assert.equal(calls[0]!.init.body, "SELECT 1");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>).authorization,
    "Bearer sk_test123",
  );
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)["content-type"],
    "text/plain; charset=utf-8",
  );
});

test("postText() includes the raw ClickHouse error in ApiError", async () => {
  mockTextFetch(() => ({ status: 403, body: "data:read scope required" }));
  const api = SuperwallApi.of(SESSION);

  await assert.rejects(
    () => api.postText("/v2/organizations/1/query", "SELECT 1"),
    (e: unknown) =>
      e instanceof ApiError && e.status === 403 && e.body === "data:read scope required",
  );
});
