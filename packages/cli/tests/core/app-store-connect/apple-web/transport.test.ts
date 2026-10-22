import assert from "node:assert/strict";
import { test } from "node:test";
import { createCookieJar } from "@/core/app-store-connect/apple-web/cookies";
import { parseJson } from "@/core/json";
import { AppleUnreachableError, createTransport, type Fetch } from "@/core/app-store-connect/apple-web/transport";

interface Seen {
  url: string;
  method?: string;
  cookie?: string;
  body?: string;
}

function server(replies: Response[]): { fetch: Fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    seen.push({
      url: String(input),
      method: init.method,
      cookie: headers.get("cookie") ?? undefined,
      body: typeof init.body === "string" ? init.body : undefined,
    });
    return replies.shift() ?? new Response("{}", { status: 200 });
  }) as Fetch;
  return { fetch, seen };
}

test("follows a redirect as GET and carries cookies set along the way", async () => {
  const { fetch, seen } = server([
    new Response(null, {
      status: 302,
      headers: { location: "/next", "set-cookie": "hop=1; Path=/" },
    }),
    new Response('{"ok":true}', { status: 200 }),
  ]);
  const transport = createTransport(createCookieJar(), fetch);
  const response = await transport.send("POST", "https://idmsa.apple.com/start", { body: { a: 1 } });
  assert.equal(response.status, 200);
  assert.deepEqual(parseJson(response.body), { ok: true });
  assert.deepEqual(seen, [
    { url: "https://idmsa.apple.com/start", method: "POST", cookie: undefined, body: '{"a":1}' },
    { url: "https://idmsa.apple.com/next", method: "GET", cookie: "hop=1", body: undefined },
  ]);
});

test("a 307 keeps the method and body", async () => {
  const { fetch, seen } = server([
    new Response(null, { status: 307, headers: { location: "https://idmsa.apple.com/again" } }),
  ]);
  await createTransport(createCookieJar(), fetch).send("PUT", "https://idmsa.apple.com/x", {
    body: { a: 1 },
  });
  assert.equal(seen[1]?.method, "PUT");
  assert.equal(seen[1]?.body, '{"a":1}');
});

test("stops following after too many redirects", async () => {
  const loop = () =>
    new Response(null, { status: 302, headers: { location: "https://idmsa.apple.com/loop" } });
  const { fetch, seen } = server(Array.from({ length: 10 }, loop));
  const response = await createTransport(createCookieJar(), fetch).send(
    "GET",
    "https://idmsa.apple.com/loop",
  );
  assert.equal(response.status, 302);
  assert.equal(seen.length, 6);
});

test("a network failure is reported as Apple being unreachable", async () => {
  const fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as Fetch;
  await assert.rejects(
    createTransport(createCookieJar(), fetch).send("GET", "https://idmsa.apple.com/"),
    AppleUnreachableError,
  );
});
