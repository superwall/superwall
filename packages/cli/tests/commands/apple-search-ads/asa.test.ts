import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asa } from "@/commands/apple-search-ads/asa";
import { ApiError } from "@/core/api/client";
import { fakeAsaApi } from "../../helpers/asa";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

async function run(
  words: string[],
  options: { flags?: Record<string, unknown>; json?: boolean } = {},
  respond?: (method: string, path: string, body?: unknown) => unknown,
) {
  const { api, requests } = fakeAsaApi(respond);
  const result = await runCommand(asa, { words, api, ...options });
  return { ...result, requests };
}

test("asa campaigns list resolves the connected app and prints rows", async () => {
  const out = await run(["campaigns"], {}, () => ({
    data: [{ id: 1, name: "Launch", status: "ENABLED", dailyBudgetAmount: { amount: "5", currency: "USD" } }],
    pagination: { totalResults: 1 },
  }));
  const proxied = out.requests.find((r) => r.path.includes("/apple-search-ads/proxy/"));
  assert.equal(proxied?.path, "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/campaigns");
  assert.ok(out.calls.some((c) => c.method === "step" && c.value === "1 campaigns"));
  assert.ok(out.calls.some((c) => c.method === "info" && c.value === "`Launch`  ENABLED  5 USD  1"));
});

test("asa campaigns get emits Apple's envelope untouched under --json", async () => {
  const out = await run(["campaigns", "get", "9"], { json: true }, () => ({
    data: { id: 9, name: "Launch" },
    pagination: null,
    error: null,
  }));
  assert.deepEqual(out.json, { data: { id: 9, name: "Launch" }, pagination: null, error: null });
});

test("asa campaigns create sends typed flags through the proxy with the org context", async () => {
  const out = await run(
    ["campaigns", "create"],
    { json: true, flags: { name: "Launch", adamId: "123", dailyBudget: "10", currency: "usd", orgId: "42" } },
    () => ({ data: { id: 1 } }),
  );
  const post = out.requests.find((r) => r.method === "POST");
  assert.deepEqual(post?.body, {
    name: "Launch",
    adamId: 123,
    dailyBudgetAmount: { amount: "10", currency: "USD" },
  });
  assert.deepEqual(post?.headers, { "x-ap-context": "orgId=42" });
});

test("a bare path is a GET of that path", async () => {
  const bare = await run(["/me"], { json: true }, () => ({ data: { userId: 1 } }));
  assert.equal(bare.requests.at(-1)?.path, "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/me");
  assert.deepEqual(bare.json, { data: { userId: 1 } });
});

test("Apple validation errors are rewritten into readable messages", async () => {
  const body = JSON.stringify({
    error: { errors: [{ messageCode: "INVALID_VALUE", message: "must be positive", field: "dailyBudgetAmount" }] },
  });
  const out = await run(["campaigns", "create"], { json: true, flags: { name: "x" } }, () => new ApiError("POST /x", 400, body));
  const error = (out.json as { error: { message: string } }).error;
  assert.match(error.message, /Apple Search Ads rejected asa campaigns create \(400\)/);
  assert.match(error.message, /dailyBudgetAmount: must be positive \(INVALID_VALUE\)/);
});

test("a missing-credentials proxy error carries the dashboard hint", async () => {
  const body = JSON.stringify({
    error: "credentials_not_found",
    message: "Apple Search Ads API credentials aren't connected",
  });
  const out = await run(["me"], { json: true }, () => new ApiError("GET /x", 404, body));
  const error = (out.json as { error: { message: string; code: string } }).error;
  assert.match(error.message, /aren't connected/);
  assert.match(error.message, /Integrations → Apple Search Ads/);
  assert.equal(error.code, "command_error");
});

test("non-JSON proxy errors and errors without Apple's shape pass through", async () => {
  const message = (out: { json: unknown }) => (out.json as { error: { message: string } }).error.message;
  const plain = await run(["me"], { json: true }, () => new ApiError("GET /x", 502, "gateway down"));
  assert.match(message(plain), /gateway down/);
  const other = await run(["me"], { json: true }, () => new ApiError("GET /x", 500, '{"message":"boom"}'));
  assert.equal(message(other), "boom");
  const thrown = await run(["me"], { json: true }, () => new Error("plain failure"));
  assert.equal(message(thrown), "plain failure");
});

test("unknown resources are rejected with the list of groups", async () => {
  const out = await run(["widgets"], { json: true });
  assert.match((out.json as { error: { message: string } }).error.message, /asa has no "widgets"\. It takes: campaigns/);
  assert.deepEqual(out.requests, [], "no app is looked up first");

  const action = await run(["campaigns", "launch"], { json: true });
  assert.match(
    (action.json as { error: { message: string } }).error.message,
    /asa campaigns has no "launch"\. It takes: list, get/,
  );
});

test("empty listings and non-list results render sensibly in rich mode", async () => {
  const empty = await run(["keywords"], { flags: { campaign: "1", adgroup: "2" } }, () => ({ data: [] }));
  assert.ok(empty.calls.some((c) => c.method === "step" && c.value === "No keywords found"));

  const report = await run(["reports", "campaigns"], { flags: { start: "2025-01-01", end: "2025-01-02" } }, () => ({
    data: { reportingDataResponse: { row: [] } },
  }));
  assert.ok(report.calls.some((c) => c.method === "report"));

  const many = await run(["geo", "search", "Paris"], {}, () => ({
    data: [{ id: "FR|IDF|Paris", displayName: "Paris, France", entity: "Locality" }, { id: "x" }],
    pagination: { totalResults: 40 },
  }));
  assert.ok(many.calls.some((c) => c.method === "step" && c.value === "2 of 40 geo"));
  assert.ok(many.calls.some((c) => c.method === "info" && c.value === "`Paris, France`  FR|IDF|Paris"));
});

test("help lists the resources, a resource's operations, and one operation's flags", async () => {
  const strip = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, "");
  const root = strip(await asa.help([]));
  assert.match(root, /superwall asa <resource> <operation>/);
  assert.match(root, /campaigns\s+list · get/);
  assert.match(root, /docs \[resource \[operation\] \| words\]/);
  const group = strip(await asa.help(["campaigns"]));
  assert.match(group, /superwall asa campaigns <operation>/);
  const operation = strip(await asa.help(["campaigns", "create"]));
  assert.match(operation, /--daily-budget <amount>/);
  assert.match(operation, /superwall asa docs campaigns create/);
});
