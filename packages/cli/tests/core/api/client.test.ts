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

const ENVELOPE = {
  type: "invalid_request_error",
  code: "resource_missing",
  message: "No such pushed paywall version: '11111'",
  param: "id",
  doc_url: "https://superwall.com/docs/errors/resource-missing",
  resource_type: "pushed paywall version",
  resource_id: "11111",
  _tag: "@superwall/api-schema/v2/errors/ResourceMissing",
};

test("an error envelope renders as its message and nothing else", async () => {
  mockFetch(() => ({ status: 404, body: ENVELOPE }));
  const api = SuperwallApi.of(SESSION);

  const error = await api.post("/v2/paywalls/208540/promote", {}).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ApiError);
  assert.equal(error.message, "No such pushed paywall version: '11111'");
  for (const noise of ["_tag", "invalid_request_error", "resource_missing", "HTTP 404", "POST /v2"]) {
    assert.ok(!error.message.includes(noise), `${noise} leaked into: ${error.message}`);
  }
});

test("the envelope's machine fields stay on the error for callers that want them", async () => {
  mockFetch(() => ({ status: 404, body: ENVELOPE }));
  const api = SuperwallApi.of(SESSION);

  const error = await api.post("/v2/paywalls/208540/promote", {}).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 404);
  assert.equal(error.envelope, true);
  assert.equal(error.detail.code, "resource_missing");
  assert.equal(error.detail.resourceId, "11111");
  assert.equal(error.detail.docUrl, "https://superwall.com/docs/errors/resource-missing");
  assert.equal(error.request, "POST /v2/paywalls/208540/promote");
});

test("a body that is not our envelope falls back to the status and a snippet", async () => {
  mockTextFetch(() => ({ status: 502, body: "<html><body>Bad Gateway</body></html>" }));
  const api = SuperwallApi.of(SESSION);

  const error = await api.postText("/v2/x", "q").then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ApiError);
  assert.equal(error.envelope, false);
  assert.match(error.message, /^HTTP 502 — /);
  assert.match(error.message, /Bad Gateway/);
});

test("a long non-envelope body is truncated rather than dumped whole", async () => {
  mockTextFetch(() => ({ status: 500, body: "x".repeat(5000) }));
  const api = SuperwallApi.of(SESSION);

  const error = await api.postText("/v2/x", "q").then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ApiError);
  assert.ok(error.message.length < 300, `message was ${error.message.length} chars`);
  assert.equal(error.body?.length, 5000);
});

test("JSON without a message is not our envelope", async () => {
  mockFetch(() => ({ status: 400, body: { error: "nope" } }));
  const api = SuperwallApi.of(SESSION);

  const error = await api.get("/v2/x").then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ApiError);
  assert.equal(error.envelope, false);
  assert.match(error.message, /^HTTP 400 — /);
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
