import assert from "node:assert/strict";
import { test } from "node:test";
import { createOutbound } from "@/core/workspaces/dev/outbound";

const org = { narrowed: false };

function setup(answers: Response[] = [new Response("{}", { status: 200 })], declared: readonly string[] = ["data:read", "projects:read"]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const logged: string[] = [];
  let renewed = 0;
  const outbound = createOutbound({
    apiOrigin: "https://api.test",
    credential: { current: async () => "token-1", renew: async (rejected) => (assert.equal(rejected, "token-1"), renewed += 1, "token-2") },
    log: { info: (text) => logged.push(`info ${text}`), warn: (text) => logged.push(`warn ${text}`) },
    declaredScopes: () => declared,
    fetchImpl: (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return answers.shift()!;
    }) as never,
  });
  return { outbound, sent, logged, renewed: () => renewed };
}

test("API calls go to the session's host with the agent token, and only the allowed headers", async () => {
  const { outbound, sent, logged } = setup();
  const answer = await outbound(
    new Request("https://api.workspace.internal/v2/organizations/1/query?a=b", {
      method: "POST",
      body: "SELECT 1",
      headers: {
        "content-type": "text/plain",
        authorization: "Bearer stolen",
        cookie: "a=b",
        "x-forwarded-for": "1.1.1.1",
      },
    }),
    org,
  );
  assert.equal(answer.status, 200);
  assert.equal(sent[0]!.url, "https://api.test/v2/organizations/1/query?a=b");
  const headers = sent[0]!.init.headers as Headers;
  assert.equal(headers.get("authorization"), "Bearer token-1");
  assert.equal(headers.get("content-type"), "text/plain");
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("x-forwarded-for"), null);
  assert.equal(Buffer.from(sent[0]!.init.body as ArrayBuffer).toString(), "SELECT 1");
  assert.equal(sent[0]!.init.redirect, "manual");
  assert.match(logged[0]!, /^info POST \/v2\/organizations\/1\/query 200 \d+ms$/);
});

test("the token never reaches the log or the answer's headers or body", async () => {
  const { outbound, logged, sent } = setup([
    new Response("nope", { status: 403, headers: { "set-cookie": "a=b", "content-encoding": "gzip", "x-from-api": "kept" } }),
  ]);
  const answer = await outbound(new Request("https://api.workspace.internal/v2/products", { method: "POST", body: "{}" }), org);
  assert.equal((sent[0]!.init.headers as Headers).get("authorization"), "Bearer token-1");
  assert.equal(answer.status, 403);
  assert.equal(answer.headers.get("set-cookie"), null);
  assert.equal(answer.headers.get("content-encoding"), null);
  assert.equal(answer.headers.get("x-from-api"), "kept");
  const everything = `${[...answer.headers.entries()].join()} ${await answer.text()} ${logged.join()}`;
  assert.match(logged[0]!, /^warn POST \/v2\/products 403 \d+ms\. Dev is read-only\. nope$/);
  assert.doesNotMatch(everything, /token-1/);
});

for (const status of [204, 205, 304]) {
  test(`a ${status} from the API reaches the Worker with no body`, async () => {
    const { outbound } = setup([new Response(null, { status })]);
    const answer = await outbound(new Request("https://api.workspace.internal/v2/projects", { headers: { "if-none-match": "x" } }), org);
    assert.equal(answer.status, status);
    assert.equal(answer.body, null);
  });
}

test("an API's stream isn't held back", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode("first"));
      await held;
      controller.close();
    },
  });
  const { outbound } = setup([new Response(stream)]);
  const answer = await outbound(new Request("https://api.workspace.internal/v2/projects"), org);
  const reader = answer.body!.getReader();
  assert.equal(Buffer.from((await reader.read()).value!).toString(), "first");
  release();
  assert.equal((await reader.read()).done, true);
});

test("when a new token can't be had, the Worker gets the 401 and the terminal gets why", async () => {
  const logged: string[] = [];
  const outbound = createOutbound({
    apiOrigin: "https://api.test",
    credential: { current: async () => "t", renew: async () => { throw new Error("no more tokens"); } },
    log: { info: (text) => logged.push(text), warn: (text) => logged.push(text) },
    declaredScopes: () => ["projects:read"],
    fetchImpl: (async () => new Response("expired", { status: 401 })) as never,
  });
  const answer = await outbound(new Request("https://api.workspace.internal/v2/projects"), org);
  assert.equal(answer.status, 401);
  assert.ok(logged.includes("no more tokens"));
});

test("a GET has no body, and a 401 renews the token once", async () => {
  const { outbound, sent, renewed } = setup([new Response("", { status: 401 }), new Response("ok", { status: 200 })]);
  const answer = await outbound(new Request("https://api.workspace.internal/v2/projects"), org);
  assert.equal(await answer.text(), "ok");
  assert.equal(sent.length, 2);
  assert.equal("body" in sent[0]!.init, false);
  assert.equal((sent[1]!.init.headers as Headers).get("authorization"), "Bearer token-2");
  assert.equal(renewed(), 1);
});

test("outside hosts are refused, and the platform host isn't here yet", async () => {
  const { outbound, sent, logged } = setup();
  const outside = await outbound(new Request("https://example.com/x"), org);
  assert.equal(outside.status, 403);
  assert.match(((await outside.json()) as { message: string }).message, /no outside hosts/);
  const platform = await outbound(new Request("https://platform.workspace.internal/kv/a"), org);
  assert.equal(platform.status, 501);
  assert.equal(sent.length, 0);
  assert.equal(logged.length, 2);
});

test("a slot tied to one app can't run SQL, as on the real runtime, and can use the rest", async () => {
  const { outbound, sent, logged } = setup();
  const query = new Request("https://api.workspace.internal/v2/organizations/1/query", { method: "POST", body: "SELECT 1" });
  const refused = await outbound(query, { narrowed: true });
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { message: string }).message, /org\.page@1 or a metric/);
  assert.equal(sent.length, 0);
  assert.match(logged[0]!, /^warn POST \/v2\/organizations\/1\/query refused/);
  assert.equal((await outbound(new Request("https://api.workspace.internal/v2/projects"), { narrowed: true })).status, 200);
});

test("a read the manifest doesn't declare warns once per scope, and still runs", async () => {
  const { outbound, sent, logged } = setup([new Response("{}"), new Response("{}"), new Response("{}")], []);
  for (const path of ["/v2/projects", "/v2/projects/7", "/v2/nothing-we-know"]) {
    await outbound(new Request(`https://api.workspace.internal${path}`), org);
  }
  assert.equal(sent.length, 3);
  const warnings = logged.filter((line) => line.startsWith("warn"));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /GET \/v2\/projects needs projects:read, which superwall\.json doesn't declare/);
});
