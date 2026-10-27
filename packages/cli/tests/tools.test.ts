import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@/core/api/client";
import { readJsonInput } from "@/core/apple-search-ads/operations";
import { memoryStore } from "@/core/state/store";
import { apiFor, callResult, instructions, listTools, useToolCache, type Tool } from "@/tools";
import { fakeResourceApi, op, type ApiCall } from "./helpers/resources";
import { routedApi } from "./helpers/routed-api";

const cache = memoryStore();
cache.write(
  "api-index.json",
  JSON.stringify({
    version: "test",
    fetchedAt: Date.now(),
    operations: [
      op("GET", "/v2/products/{id}"),
      op("PATCH", "/v2/products/{id}", {
        body: [
          { name: "name", type: "string", required: false, description: "Display name" },
          { name: "price", type: "number | null", required: false },
        ],
      }),
      op("DELETE", "/v2/products/{id}"),
    ],
  }),
);
useToolCache(cache);

const tools = await listTools();
const tool = (name: string): Tool => {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found, `no ${name} tool`);
  return found;
};

test("every data command and catalog operation is a tool; work that needs the machine is not", () => {
  const names = new Set(tools.map((candidate) => candidate.name));
  for (const name of ["products_list", "products_get", "products_create", "apps_get", "campaigns_variants_update", "query", "bootstrap", "get", "api_docs", "asc_get", "asc_keys_list", "asc_notification_url_check", "asa_campaigns_list", "asa_get"]) {
    assert.ok(names.has(name), `${name} should be a tool`);
  }
  for (const name of ["integrate", "migrate", "login", "logout", "whoami", "doctor", "upgrade", "push", "dev", "apps_use", "products_storekit", "setup_apple", "asc_keys_create"]) {
    assert.ok(!names.has(name), `${name} needs the user's machine, so it isn't a tool`);
  }
});

test("every tool has a title a person can read", () => {
  assert.equal(tool("products_create").title, "Products create");
  assert.equal(tool("asc_keys_list").title, "ASC keys list");
  assert.equal(tool("asa_negative_keywords_find").title, "ASA negative keywords find");
  assert.equal(tool("post").title, "POST");
});

test("a result becomes the protocol's answer: text, structured content for objects, the error flag", () => {
  assert.deepEqual(callResult({ ok: true, data: { id: "1" } }), {
    content: [{ type: "text", text: '{\n  "id": "1"\n}' }],
    structuredContent: { id: "1" },
    isError: false,
  });
  assert.deepEqual(callResult({ ok: false, data: [1] }), { content: [{ type: "text", text: "[\n  1\n]" }], isError: true });
});

test("the instructions route analytics to query and machine work to the CLI", () => {
  const text = instructions();
  assert.match(text, /Analytics: query runs ClickHouse SQL/);
  assert.match(text, /Confirm with the user before calling one/);
  assert.match(text, /asc_ tools/);
});

test("apiFor sends the caller's token to the host it names", async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify({ id: "1" }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await tool("get").run({ path: "/v2/projects/1" }, apiFor({ token: "tok_123", host: "https://api.example.com" }));
    assert.deepEqual(result, { ok: true, data: { id: "1" } });
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(seen, [{ url: "https://api.example.com/v2/projects/1", auth: "Bearer tok_123" }]);
});

test("tools that reach Apple or a customer's endpoint say so", () => {
  assert.equal(tool("asc_keys_list").annotations.openWorldHint, true);
  assert.equal(tool("asa_campaigns_list").annotations.openWorldHint, true);
  assert.equal(tool("products_list").annotations.openWorldHint, false);
  assert.equal(tool("webhooks_create").annotations.openWorldHint, true);
  assert.equal(tool("webhooks_update").annotations.openWorldHint, true);
  assert.equal(tool("webhooks_list").annotations.openWorldHint, false);
  assert.equal(tool("webhooks_delete").annotations.openWorldHint, false);
  assert.equal(tool("asa_negative_keywords_delete").annotations.destructiveHint, true);
});

test("credentials stay out of MCP inputs", () => {
  const inputs = Object.keys(tool("apps_update").inputSchema.properties);
  for (const secret of ["revenue_cat_public_api_key", "app_store_connect_shared_secret", "stripe_private_key"]) {
    assert.ok(!inputs.includes(secret), `${secret} must not be an MCP input`);
  }
});

test("hints follow what the command does", () => {
  assert.equal(tool("products_list").annotations.readOnlyHint, true);
  assert.equal(tool("products_delete").annotations.destructiveHint, true);
  assert.equal(tool("post").annotations.readOnlyHint, false);
  assert.equal(tool("post").annotations.destructiveHint, false);
  assert.equal(tool("delete").annotations.destructiveHint, true);
  for (const name of ["products_update", "campaigns_placements_create", "campaigns_audiences_update", "campaigns_variants_update", "asc_builds_attach", "paywalls_publish"]) {
    assert.equal(tool(name).annotations.destructiveHint, true, name);
    assert.equal(tool(name).annotations.readOnlyHint, false, name);
  }
  assert.equal(tool("entitlements_grants_create").annotations.readOnlyHint, false);
  assert.equal(tool("entitlements_grants_create").annotations.destructiveHint, false);
  assert.equal(tool("paywalls_publish").annotations.openWorldHint, false);
  assert.equal(tool("paywalls_publish").annotations.idempotentHint, false);
});

test("inputs come from the command: arguments, flags, and the API's own fields", () => {
  const update = tool("products_update").inputSchema;
  assert.deepEqual(update.required, ["id"]);
  assert.deepEqual(update.properties.name, { type: "string", description: "Display name" });
  assert.deepEqual(update.properties.price, { type: ["number", "null"] });
  const get = tool("get").inputSchema;
  assert.ok(get.required.includes("path"));
  assert.equal(get.properties.yes, undefined, "tools never ask, so --yes isn't an input");
  assert.equal(tool("query").inputSchema.properties.install_dir, undefined);
  assert.deepEqual(tool("query").inputSchema.required, ["sql"], "a tool has no stdin, so the SQL is required");
  assert.equal(tool("query").inputSchema.properties.file, undefined, "nor a file to read it from");
  assert.deepEqual(tool("apps_create").inputSchema.required, ["name", "platform"]);
  assert.deepEqual(tool("asa_adgroups_list").inputSchema.required, ["campaign"]);
  assert.deepEqual(tool("asa_campaigns_get").inputSchema.required, ["id"]);
  assert.deepEqual(tool("asa_reports_campaigns").inputSchema.required, ["start", "end"]);
});

test("a call runs the command and answers with its --json output", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "PATCH /v2/products/42": { id: "42", name: "Pro" } });
  const result = await tool("products_update").run({ id: "42", name: "Pro", price: 9.99 }, api);
  assert.deepEqual(result, { ok: true, data: { id: "42", name: "Pro" } });
  assert.deepEqual(calls, [{ method: "PATCH", path: "/v2/products/42", body: { name: "Pro", price: 9.99 } }]);
});

test("a destructive call goes ahead: the client asked the user before calling", async () => {
  const calls: ApiCall[] = [];
  const result = await tool("products_delete").run({ id: "42" }, fakeResourceApi(calls));
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ method: "DELETE", path: "/v2/products/42" }]);
});

test("a command tool takes its arguments by name", async () => {
  const { api, sent } = routedApi({ "GET /v2/projects/1": { id: "1" } });
  const result = await tool("get").run({ path: "/v2/projects/1" }, api);
  assert.deepEqual(result, { ok: true, data: { id: "1" } });
  assert.deepEqual(sent, [{ method: "GET", path: "/v2/projects/1" }]);
});

test("a failure is the command's error, marked not ok", async () => {
  const { api } = routedApi({
    "GET /v2/products/9": new ApiError("GET /v2/products/9", 404, '{"message":"No such product"}'),
  });
  const result = await tool("products_get").run({ id: "9" }, api);
  assert.equal(result.ok, false);
  assert.deepEqual(result.data, { error: { code: "api_error", message: "No such product", status: 404 } });
});

test("files and stdin aren't there: an @file input says to pass the value", () => {
  assert.throws(() => readJsonInput("@payload.json", "--body"), /Files and stdin aren't available here: pass the value itself/);
  assert.deepEqual(readJsonInput({ name: "Spring" }, "--body"), { name: "Spring" });
});

test("the instructions send an agent with a shell to the CLI, and name the work only it can do", () => {
  const text = instructions();
  assert.match(text, /If you can run shell commands, use the CLI itself/);
  assert.match(text, /npx superwall@latest login/);
  assert.match(text, /migrating from RevenueCat/);
  assert.doesNotMatch(text, /^- superwall /m);
});

test("publish and manual grants describe their live effects", () => {
  assert.match(tool("paywalls_publish").description, /latest saved draft/);
  assert.match(tool("paywalls_publish").description, /Replaces its currently deployed version and refreshes app configuration/);
  assert.match(tool("paywalls_publish").description, /users by campaigns/);
  assert.match(tool("entitlements_grants_create").description, /existing entitlement manually to an app user or device/);
  assert.match(tool("entitlements_grants_create").description, /expiry time/);
  assert.match(tool("entitlements_grants_create").description, /without charging the user or creating a paid subscription/);
  assert.match(tool("entitlements_grants_create").description, /error when an active grant already exists/);
});

test("the MCP retains generic API and schema tools with fallback guidance", () => {
  for (const name of ["get", "post", "patch", "delete", "api_docs", "asc_get", "asc_post", "asc_patch", "asc_delete", "asc_docs", "asa_get", "asa_post", "asa_put", "asa_delete", "asa_docs"]) {
    assert.ok(tools.some((candidate) => candidate.name === name), name);
  }
  assert.match(instructions(), /api_docs finds it, then get, post, patch or delete calls it/);
});
