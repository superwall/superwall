import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createSuperwallApi, superwallApi, withQuery, ApiUnreachableError } from "@/core/api/client";
import { NotLoggedInError } from "@/core/account/errors";
import { clearHomes, useHome } from "../../helpers/home";
import type { Session } from "@/core/account/storage";
import { USER_AGENT } from "@/environment";

const SESSION: Session = {
  apiKey: "sk_test123",
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
  const api = createSuperwallApi(SESSION);
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
  const api = createSuperwallApi(SESSION);
  await assert.rejects(
    () => api.get("/v2/x"),
    (e: unknown) => e instanceof ApiError && e.status === 400,
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
  const api = createSuperwallApi(SESSION);

  const error = await api.post("/v2/paywalls/208540/promote", {}).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ApiError);
  assert.equal(error.message, "No such pushed paywall version: '11111'");
  for (const noise of [
    "_tag",
    "invalid_request_error",
    "resource_missing",
    "HTTP 404",
    "POST /v2",
  ]) {
    assert.ok(!error.message.includes(noise), `${noise} leaked into: ${error.message}`);
  }
});

test("the envelope's machine fields stay on the error for callers that want them", async () => {
  mockFetch(() => ({ status: 404, body: ENVELOPE }));
  const api = createSuperwallApi(SESSION);

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
  const api = createSuperwallApi(SESSION);

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
  const api = createSuperwallApi(SESSION);

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
  const api = createSuperwallApi(SESSION);

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
  const api = createSuperwallApi(SESSION);
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
  const api = createSuperwallApi(SESSION);
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

test("every request carries the CLI's User-Agent, or the one the client was made with", async () => {
  const calls = mockFetch(() => ({ body: { data: [], has_more: false } }));
  await createSuperwallApi(SESSION).get("/v2/thing");
  const custom = createSuperwallApi(SESSION, { userAgent: "Superwall-MCP/1.0 (claude-ai/0.1.0)" });
  await custom.list("/v2/projects");
  await custom.forOrg("7").post("/v2/thing", {}, { headers: { "user-agent": "per-request/1" } });
  const agents = calls.map((call) => (call.init.headers as Record<string, string>)["user-agent"]);
  assert.deepEqual(agents, [USER_AGENT(), "Superwall-MCP/1.0 (claude-ai/0.1.0)", "per-request/1"]);

  const text = mockTextFetch(() => ({ body: "1" }));
  await custom.postText("/v2/organizations/1/query", "SELECT 1");
  assert.equal(
    (text[0]!.init.headers as Record<string, string>)["user-agent"],
    "Superwall-MCP/1.0 (claude-ai/0.1.0)",
  );
});

test("a request's own User-Agent replaces the client's whatever its casing", async () => {
  const calls = mockFetch(() => ({ body: {} }));
  await createSuperwallApi(SESSION).get("/v2/thing", { headers: { "User-Agent": "Superwall-MCP/1.0" } });
  assert.equal(new Headers(calls[0]!.init.headers).get("user-agent"), "Superwall-MCP/1.0");
});

test("postText() includes the raw ClickHouse error in ApiError", async () => {
  mockTextFetch(() => ({ status: 403, body: "data:read scope required" }));
  const api = createSuperwallApi(SESSION);

  await assert.rejects(
    () => api.postText("/v2/organizations/1/query", "SELECT 1"),
    (e: unknown) =>
      e instanceof ApiError && e.status === 403 && e.body === "data:read scope required",
  );
});

test("put() sends a JSON body and per-request headers ride along", async () => {
  const calls = mockFetch(() => ({ body: { ok: true } }));
  const api = createSuperwallApi(SESSION);
  await api.put("/v2/thing/1", { name: "x" }, { headers: { "x-ap-context": "orgId=1" } });
  assert.equal(calls[0]!.init.method, "PUT");
  assert.equal(calls[0]!.init.body, JSON.stringify({ name: "x" }));
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["x-ap-context"], "orgId=1");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers.authorization, "Bearer sk_test123");

  await api.del("/v2/thing/1", { headers: { "x-ap-context": "orgId=2" } });
  assert.equal(calls[1]!.init.method, "DELETE");
  assert.equal((calls[1]!.init.headers as Record<string, string>)["x-ap-context"], "orgId=2");
  assert.equal(calls[1]!.init.body, undefined);
});

test("custom headers can't override the session's authorization", async () => {
  const calls = mockFetch(() => ({ body: {} }));
  const api = createSuperwallApi(SESSION);
  await api.get("/v2/thing", { headers: { authorization: "Bearer stolen" } });
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>).authorization,
    "Bearer sk_test123",
  );
});

test("withQuery appends params and refuses nested ones", () => {
  assert.equal(withQuery("/campaigns", { limit: 5 }), "/campaigns?limit=5");
  assert.equal(withQuery("/campaigns?x=1", new URLSearchParams({ y: "2" })), "/campaigns?x=1&y=2");
  assert.equal(withQuery("/campaigns", {}), "/campaigns");
  assert.throws(() => withQuery("/c", { a: { b: 1 } }), /Nested/);
});

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

  await assert.rejects(createSuperwallApi(session).get("/v2/projects"), (error: Error) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.match(error.message, /http:\/\/localhost:3001/);
    assert.match(error.message, /start the API/);
    return true;
  });
});

test("an unreachable hosted API points at the network, not the server", async () => {
  delete process.env.SUPERWALL_API_HOST;
  globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));

  await assert.rejects(createSuperwallApi(session).get("/v2/projects"), (error: Error) => {
    assert.match(error.message, /api\.superwall\.com/);
    assert.match(error.message, /network or proxy/);
    return true;
  });
});

test("HTTP failures still surface status and body", async () => {
  delete process.env.SUPERWALL_API_HOST;
  globalThis.fetch = () => Promise.resolve(new Response("nope", { status: 409 }));

  await assert.rejects(createSuperwallApi(session).get("/v2/paywalls"), (error: Error) => {
    assert.match(error.message, /HTTP 409/);
    return true;
  });
});

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

test("an error body that can't be read still reports the status", async () => {
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("connection reset"));
        },
      }),
      { status: 502 },
    )) as typeof fetch;
  await assert.rejects(api().post("/v2/paywalls", {}), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, "HTTP 502");
    return true;
  });
});

test("a busy answer without a usable retry-after backs off on its own schedule", async () => {
  const methods: string[] = [];
  const statuses = [503, 200];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? '{"ok":true}' : "busy", { status, headers: { "retry-after": "-1" } });
  }) as typeof fetch;
  const started = Date.now();
  assert.deepEqual(await api().get("/v2/projects"), { ok: true });
  assert.ok(Date.now() - started >= 350);
  assert.deepEqual(methods, ["GET", "GET"]);
});

test("a 204 answer resolves to nothing, and the client reports its host, email and organization", async () => {
  const calls = mockFetch(() => ({ status: 204 }));
  const client = createSuperwallApi({ ...SESSION, userEmail: "dev@acme.com" });
  assert.equal(await client.del("/v2/paywalls/1"), undefined);
  assert.equal(calls[0]?.init.method, "DELETE");
  assert.equal(client.host, "https://api.example.com");
  assert.equal(client.userEmail, "dev@acme.com");
  const scoped = client.forOrg("7").forOrg("8");
  assert.deepEqual(scoped.org, { id: "8" });
  assert.deepEqual(client.org, {});
});

test("list() stops on an empty page or a row it can't page past", async () => {
  const empty = mockFetch(() => ({ body: { data: [], has_more: true } }));
  assert.deepEqual(await createSuperwallApi(SESSION).list("/v2/products"), []);
  assert.equal(empty.length, 1);
  for (const last of [{ name: "no id" }, { id: null }, "plain"]) {
    const calls = mockFetch(() => ({ body: { data: [last], has_more: true } }));
    assert.deepEqual(await createSuperwallApi(SESSION).list("/v2/products"), [last]);
    assert.equal(calls.length, 1);
  }
});

test("superwallApi needs a saved login", async () => {
  useHome();
  try {
    assert.throws(() => superwallApi(), NotLoggedInError);
    useHome({ apiKey: "sk_saved" });
    const calls = mockFetch(() => ({ body: { ok: 1 } }));
    assert.deepEqual(await superwallApi().get("/v2/me"), { ok: 1 });
    assert.equal(calls[0]?.url, "https://api.example.com/v2/me");
  } finally {
    clearHomes();
  }
});

test("patch() sends its JSON body, and errors without a body or with a JSON scalar keep the status", async () => {
  const calls = mockFetch(() => ({ body: { ok: true } }));
  assert.deepEqual(await createSuperwallApi(SESSION).patch("/v2/paywalls/1", { name: "x" }), { ok: true });
  assert.equal(calls[0]?.init.method, "PATCH");
  assert.equal(calls[0]?.init.body, '{"name":"x"}');

  assert.equal(new ApiError("GET /x", 500).message, "HTTP 500");
  for (const body of ["null", "3"]) {
    const error = new ApiError("GET /x", 400, body);
    assert.equal(error.envelope, false);
    assert.equal(error.message, `HTTP 400 — ${body}`);
  }
});

// What Node's fetch throws: `TypeError: fetch failed`, with the socket's error as its cause.
const nodeFetchFailure = (code: string, message: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });

function dropThenAnswer(failures: unknown[]): { method: string; body: unknown }[] {
  const sent: { method: string; body: unknown }[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push({ method: init?.method ?? "GET", body: init?.body });
    const failure = failures.shift();
    if (failure !== undefined) throw failure;
    return new Response('{"id":"draft"}', { status: 200 });
  }) as typeof fetch;
  return sent;
}

test("an idempotent write whose connection drops is sent again, with the same body", async () => {
  const sent = dropThenAnswer([nodeFetchFailure("EPIPE", "write EPIPE"), nodeFetchFailure("UND_ERR_SOCKET", "other side closed")]);
  const started = Date.now();
  assert.deepEqual(await api().post("/v2/artifacts/drafts", { module: "x" }, { idempotent: true }), { id: "draft" });
  assert.ok(Date.now() - started >= 700, "it backs off between attempts");
  assert.deepEqual(sent.map((call) => call.method), ["POST", "POST", "POST"]);
  assert.deepEqual(new Set(sent.map((call) => call.body)), new Set(['{"module":"x"}']));
});

test("a dropped connection is tried three times in all, then says what dropped it", async () => {
  const sent = dropThenAnswer([1, 2, 3, 4].map(() => nodeFetchFailure("EPIPE", "write EPIPE")));
  await assert.rejects(api().post("/v2/artifacts/drafts", {}, { idempotent: true }), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.equal(error.dropped, true);
    assert.equal(error.code, "EPIPE");
    assert.equal(
      error.message,
      "Lost the connection while sending to the Superwall API at https://api.example.com (EPIPE).\n  It closed before the request finished. Try again.",
    );
    return true;
  });
  assert.equal(sent.length, 3);
});

test("a dropped connection isn't retried for a write that didn't say it's safe to repeat", async () => {
  const sent = dropThenAnswer([nodeFetchFailure("ECONNRESET", "read ECONNRESET")]);
  await assert.rejects(api().post("/v2/paywalls", {}), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.match(error.message, /^Lost the connection to the Superwall API at https:\/\/api\.example\.com \(ECONNRESET\)\./);
    return true;
  });
  assert.equal(sent.length, 1);
});

test("a connection that never opened isn't retried, and keeps the network hint with its cause", async () => {
  const sent = dropThenAnswer([nodeFetchFailure("ENOTFOUND", "getaddrinfo ENOTFOUND api.example.com")]);
  await assert.rejects(api().post("/v2/artifacts/drafts", {}, { idempotent: true }), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.equal(error.dropped, false);
    assert.equal(
      error.message,
      "Couldn't reach the Superwall API at https://api.example.com (ENOTFOUND).\n  Check your network or proxy, then try again.",
    );
    return true;
  });
  assert.equal(sent.length, 1);
});

test("an HTTP answer to an idempotent write is never retried, 4xx included", async () => {
  const methods = respond([400, 200]);
  await assert.rejects(api().post("/v2/artifacts/drafts", {}, { idempotent: true }), ApiError);
  assert.deepEqual(methods, ["POST"]);
});

test("the cause is found wherever the runtime put it", () => {
  const host = "https://api.example.com";
  const label = (cause: unknown) => new ApiUnreachableError(host, cause).message.split("\n")[0];
  // undici's own socket error: its message adds something the code doesn't.
  assert.equal(label(nodeFetchFailure("UND_ERR_SOCKET", "other side closed")), `Lost the connection to the Superwall API at ${host} (UND_ERR_SOCKET: other side closed).`);
  // Bun puts the code on the error it throws.
  const bun = Object.assign(new Error("The socket connection was closed unexpectedly."), { code: "ECONNRESET" });
  assert.equal(new ApiUnreachableError(host, bun).dropped, true);
  // A connect to every address failing arrives as an AggregateError.
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" });
  const aggregate = Object.assign(new TypeError("fetch failed"), { cause: new AggregateError([refused], "") });
  assert.equal(label(aggregate), `Couldn't reach the Superwall API at ${host} (ECONNREFUSED).`);
  // No code at all: the message is what there is, and a bare "fetch failed" says nothing.
  assert.equal(label(Object.assign(new TypeError("fetch failed"), { cause: new Error("socket hang up") })), `Lost the connection to the Superwall API at ${host} (socket hang up).`);
  assert.equal(label(new TypeError("fetch failed")), `Couldn't reach the Superwall API at ${host}.`);
  assert.equal(label("not an error"), `Couldn't reach the Superwall API at ${host}.`);
  // A cause that points back at itself doesn't loop.
  const loop: { cause?: unknown; code: string } = { code: "EPIPE" };
  loop.cause = loop;
  assert.equal(new ApiUnreachableError(host, loop).code, "EPIPE");
});

function stall(): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return new Promise<Response>((_resolve, reject) => {
      const { signal } = init;
      if (!signal) return;
      const open = setInterval(() => {}, 1000);
      const onAbort = () => {
        clearInterval(open);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }) as typeof fetch;
  return calls;
}

test("a write the API never answers stops at the deadline and says it may have landed", async () => {
  const calls = stall();
  const api = createSuperwallApi(SESSION, { timeoutMs: 20 });
  await assert.rejects(api.post("/v2/campaigns/1/placements", { event_name: "recipes" }), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.equal(error.timedOut, true);
    assert.equal(error.dropped, false);
    assert.equal(
      error.message,
      "The Superwall API at https://api.example.com didn't answer within 0.02s.\n  The change may or may not have been applied. Check before sending it again.",
    );
    return true;
  });
  assert.equal(calls.length, 1);
});

test("a read the API never answers stops at the deadline and is sent once", async () => {
  const calls = stall();
  const api = createSuperwallApi(SESSION, { timeoutMs: 20 });
  await assert.rejects(api.get("/v2/campaigns"), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.equal(error.timedOut, true);
    assert.equal(
      error.message,
      "The Superwall API at https://api.example.com didn't answer within 0.02s.\n  Try again.",
    );
    return true;
  });
  assert.equal(calls.length, 1);
});

test("a timed-out write isn't sent again even when it's safe to repeat", async () => {
  const calls = stall();
  const api = createSuperwallApi(SESSION, { timeoutMs: 20 });
  await assert.rejects(api.post("/v2/artifacts/drafts", {}, { idempotent: true }), (error: unknown) => {
    return error instanceof ApiUnreachableError && error.timedOut;
  });
  assert.equal(calls.length, 1);
});

test("postText waits for its own, longer deadline", async () => {
  const calls = stall();
  const api = createSuperwallApi(SESSION, { timeoutMs: 20, textTimeoutMs: 150 });
  const started = Date.now();
  await assert.rejects(api.postText("/v2/query", "SELECT 1"), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.match(error.message, /didn't answer within 0\.15s\.\n  The change may or may not have been applied\./);
    return true;
  });
  assert.ok(Date.now() - started >= 140, "the request deadline didn't cut it short");
  assert.equal(calls.length, 1);
});

function stallBody(): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const { signal } = init;
    const open = setInterval(() => {}, 1000);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener(
          "abort",
          () => {
            clearInterval(open);
            controller.error(signal.reason);
          },
          { once: true },
        );
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("an answer whose body stalls is the same timeout, for reads, writes and postText", async () => {
  const calls = stallBody();
  const api = createSuperwallApi(SESSION, { timeoutMs: 20, textTimeoutMs: 40 });
  const host = "The Superwall API at https://api.example.com didn't answer within";
  const landed = "The change may or may not have been applied. Check before sending it again.";
  await assert.rejects(api.get("/v2/campaigns"), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.equal(error.timedOut, true);
    assert.equal(error.message, `${host} 0.02s.\n  Try again.`);
    return true;
  });
  await assert.rejects(api.post("/v2/campaigns/1/placements", {}, { idempotent: true }), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.equal(error.message, `${host} 0.02s.\n  ${landed}`);
    return true;
  });
  await assert.rejects(api.postText("/v2/query", "SELECT 1"), (error: unknown) => {
    assert.ok(error instanceof ApiUnreachableError);
    assert.equal(error.message, `${host} 0.04s.\n  ${landed}`);
    return true;
  });
  assert.equal(calls.length, 3);
});

test("a body that fails for another reason keeps its own error", async () => {
  mockTextFetch(() => ({ body: "not json" }));
  await assert.rejects(createSuperwallApi(SESSION).get("/v2/thing"), SyntaxError);
});

test("every request carries a deadline, and an answer in time isn't a timeout", async () => {
  const calls = mockFetch(() => ({ body: { ok: true } }));
  assert.deepEqual(await createSuperwallApi(SESSION).get("/v2/thing"), { ok: true });
  assert.ok(calls[0]!.init.signal instanceof AbortSignal);
  assert.equal(new ApiUnreachableError("https://api.example.com", new Error("boom")).timedOut, false);
});
