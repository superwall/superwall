import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createSuperwallApi } from "@/core/api/client";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { helpLine, runLine } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  process.exitCode = 0;
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

test("delete sends a DELETE with -d as the query, and prints the API's answer", async () => {
  useHome();
  const log = useFetch([{ match: "/v2/products/12", body: { id: "12", deleted: true } }]);

  const result = await runLine("delete /v2/products/12 -d force:=true -d reason=gone --json", { api: api() });

  assert.deepEqual(
    log.map(({ url, method, body }) => ({ url, method, body })),
    [{ url: "https://api.example.com/v2/products/12?force=true&reason=gone", method: "DELETE", body: undefined }],
  );
  assert.deepEqual(result.json, { id: "12", deleted: true });
});

test("a DELETE the API answers with no content prints ok", async () => {
  useHome();
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;

  const result = await runLine("delete /v2/entitlements/7 --json", { api: api() });

  assert.deepEqual(result.json, { ok: true });
});

test("a DELETE of a path the API doesn't have says where to look", async () => {
  useHome();
  useFetch([
    {
      match: "/openapi.json",
      body: {
        info: { version: "2.0.0" },
        paths: { "/v2/products/{id}": { get: { tags: ["Products V2"], summary: "Get Product", responses: {} } } },
      },
    },
    { match: "/v2/products/12", status: 405, body: { error: { message: "Method not allowed" } } },
  ]);

  const result = await runLine("delete /v2/products/12 --json", { api: api() });

  const message = (result.json as { error: { message: string } }).error.message;
  assert.match(message, /Method not allowed/);
  assert.match(message, /\/v2\/products\/12 takes GET, not DELETE: superwall api docs \/v2\/products\/\{id\}/);
  assert.equal(process.exitCode, 1);
});

test("delete without a path is refused by the parser, before any request", async () => {
  const log = useFetch([]);

  await assert.rejects(runLine("delete --json", { api: api() }), /Missing <path>/);
  assert.equal(log.length, 0);
});

test("delete --help shows its argument, -d and an example", async () => {
  const help = await helpLine("delete --help");

  assert.match(help, /Make DELETE requests to the Superwall API/);
  assert.match(help, /<path>/);
  assert.match(help, /-d/);
  assert.match(help, /delete \/v2\/products\/<id>/);
});
