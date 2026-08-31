import assert from "node:assert/strict";
import { test } from "node:test";
import { executeCommand } from "@/command";
import { runAsa } from "@/commands/platform/asa";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const PROJECTS = {
  data: [
    {
      id: 1,
      name: "Acme",
      applications: [{ id: 5, name: "Acme iOS", platform: "ios", apple_search_ads_configured: true }],
    },
  ],
};

interface Captured {
  stdout: string;
  calls: RendererCall[];
  requests: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }>;
}

async function run(
  argv: Record<string, unknown>,
  respond: (method: string, path: string, body?: unknown) => unknown = () => ({ data: [] }),
): Promise<Captured> {
  const captured: Captured = { stdout: "", calls: [], requests: [] };
  const handle = (method: string) => async (path: string, bodyOrOptions?: unknown, options?: unknown) => {
    const body = method === "GET" || method === "DELETE" ? undefined : bodyOrOptions;
    const opts = (method === "GET" || method === "DELETE" ? bodyOrOptions : options) as
      | { headers?: Record<string, string> }
      | undefined;
    captured.requests.push({ method, path, body, headers: opts?.headers });
    const res = respond(method, path, body);
    if (res instanceof Error) throw res;
    return res;
  };
  const api = {
    org: { id: "org-1" },
    list: async (path: string) => {
      captured.requests.push({ method: "LIST", path });
      return PROJECTS.data;
    },
    get: handle("GET"),
    post: handle("POST"),
    put: handle("PUT"),
    del: handle("DELETE"),
  } as unknown as SuperwallApi;
  await executeCommand(
    runAsa.definition,
    { _: [], $0: "superwall", ...argv },
    {
      api: () => api,
      renderer: () => recordingRenderer(captured.calls),
      stdout: {
        write: (value) => {
          captured.stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );
  process.exitCode = 0;
  return captured;
}

test("asa keys list reports which apps are connected, as JSON and as rows", async () => {
  const json = await run({ target: "keys", action: "list", json: true });
  assert.deepEqual(JSON.parse(json.stdout), [{ id: "5", name: "Acme iOS", project: "Acme", connected: true }]);
  assert.deepEqual(json.calls.map((c) => c.method), ["start", "stop"]);

  const rich = await run({ target: "keys" });
  assert.ok(rich.calls.some((c) => c.method === "step" && String(c.value).includes("1 of 1 iOS app connected")));
  assert.ok(rich.calls.some((c) => c.method === "info" && String(c.value).includes("`Acme iOS`  connected  5")));
});

test("asa keys set explains that credentials live in the dashboard", async () => {
  const out = await run({ target: "keys", action: "set", json: true });
  assert.match(JSON.parse(out.stdout).error.message, /managed in the dashboard/);
});

test("asa campaigns list resolves the connected app and prints rows", async () => {
  const out = await run({ target: "campaigns" }, () => ({
    data: [{ id: 1, name: "Launch", status: "ENABLED", dailyBudgetAmount: { amount: "5", currency: "USD" } }],
    pagination: { totalResults: 1 },
  }));
  const proxied = out.requests.find((r) => r.path.includes("/apple-search-ads/proxy/"));
  assert.equal(proxied?.path, "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/campaigns");
  assert.ok(out.calls.some((c) => c.method === "step" && c.value === "1 campaigns"));
  assert.ok(out.calls.some((c) => c.method === "info" && c.value === "`Launch`  ENABLED  5 USD  1"));
});

test("asa campaigns get emits Apple's envelope untouched under --json", async () => {
  const out = await run({ target: "campaigns", action: "get", value: "9", json: true }, () => ({
    data: { id: 9, name: "Launch" },
    pagination: null,
    error: null,
  }));
  assert.deepEqual(JSON.parse(out.stdout), { data: { id: 9, name: "Launch" }, pagination: null, error: null });
});

test("asa campaigns create sends typed flags through the proxy with the org context", async () => {
  const out = await run(
    { target: "campaigns", action: "create", name: "Launch", "adam-id": "123", "daily-budget": "10", currency: "usd", "org-id": "42", json: true },
    () => ({ data: { id: 1 } }),
  );
  const post = out.requests.find((r) => r.method === "POST");
  assert.deepEqual(post?.body, { name: "Launch", adamId: 123, dailyBudgetAmount: { amount: "10", currency: "USD" } });
  assert.deepEqual(post?.headers, { "x-ap-context": "orgId=42" });
});

test("raw verbs pass -d as query params on get and as the body on post", async () => {
  const get = await run({ target: "get", action: "/campaigns", d: ["limit=3"], json: true });
  assert.equal(get.requests.at(-1)?.path, "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/campaigns?limit=3");

  const post = await run({ target: "post", action: "/campaigns/find", body: '{"conditions":[]}', d: ["fields:=[\"id\"]"], json: true });
  assert.deepEqual(post.requests.at(-1)?.body, { conditions: [], fields: ["id"] });

  const bare = await run({ target: "/me", json: true }, () => ({ data: { userId: 1 } }));
  assert.equal(bare.requests.at(-1)?.path, "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/me");
  assert.deepEqual(JSON.parse(bare.stdout), { data: { userId: 1 } });

  const bad = await run({ target: "put", action: "campaigns", json: true });
  assert.match(JSON.parse(bad.stdout).error.message, /must start with/);

  const del = await run({ target: "delete", action: "/campaigns/1", json: true }, () => undefined);
  assert.deepEqual(JSON.parse(del.stdout), { ok: true });
});

test("asa docs renders the catalog, a group, and a search without touching the API", async () => {
  const catalog = await run({ target: "docs", json: true });
  assert.equal(catalog.requests.length, 0);
  assert.match(JSON.parse(catalog.stdout).markdown, /# Apple Search Ads/);

  const group = await run({ target: "docs", action: "keywords", json: true });
  assert.match(JSON.parse(group.stdout).markdown, /# asa keywords/);

  const search = await run({ target: "docs", action: "budget", json: true });
  assert.match(JSON.parse(search.stdout).markdown, /budget-orders/);
});

test("Apple validation errors are rewritten into readable messages", async () => {
  const body = JSON.stringify({
    error: { errors: [{ messageCode: "INVALID_VALUE", message: "must be positive", field: "dailyBudgetAmount" }] },
  });
  const out = await run({ target: "campaigns", action: "create", name: "x", json: true }, () =>
    new ApiError("POST /x", 400, body),
  );
  const error = JSON.parse(out.stdout).error;
  assert.match(error.message, /Apple Search Ads rejected asa campaigns create \(400\)/);
  assert.match(error.message, /dailyBudgetAmount: must be positive \(INVALID_VALUE\)/);
});

test("a missing-credentials proxy error carries the dashboard hint", async () => {
  const body = JSON.stringify({ error: "credentials_not_found", message: "Apple Search Ads API credentials aren't connected" });
  const out = await run({ target: "me", json: true }, () => new ApiError("GET /x", 404, body));
  const error = JSON.parse(out.stdout).error;
  assert.match(error.message, /aren't connected/);
  assert.match(error.message, /Integrations → Apple Search Ads/);
  assert.equal(error.code, "command_error");
});

test("non-JSON proxy errors and errors without Apple's shape pass through", async () => {
  const plain = await run({ target: "me", json: true }, () => new ApiError("GET /x", 502, "gateway down"));
  assert.match(JSON.parse(plain.stdout).error.message, /gateway down/);
  const other = await run({ target: "me", json: true }, () => new ApiError("GET /x", 500, '{"message":"boom"}'));
  assert.equal(JSON.parse(other.stdout).error.message, "boom");
  const thrown = await run({ target: "me", json: true }, () => new Error("plain failure"));
  assert.equal(JSON.parse(thrown.stdout).error.message, "plain failure");
});

test("unknown resources are rejected with the list of groups", async () => {
  const out = await run({ target: "widgets", json: true });
  assert.match(JSON.parse(out.stdout).error.message, /Unknown "asa widgets"/);
});

test("empty listings and non-list results render sensibly in rich mode", async () => {
  const empty = await run({ target: "keywords", campaign: "1", adgroup: "2" }, () => ({ data: [] }));
  assert.ok(empty.calls.some((c) => c.method === "step" && c.value === "No keywords found"));

  const report = await run({ target: "reports", action: "campaigns", start: "2025-01-01", end: "2025-01-02" }, () => ({
    data: { reportingDataResponse: { row: [] } },
  }));
  assert.ok(report.calls.some((c) => c.method === "report"));

  const many = await run({ target: "geo", action: "search", value: "Paris" }, () => ({
    data: [{ id: "FR|IDF|Paris", displayName: "Paris, France", entity: "Locality" }, { id: "x" }],
    pagination: { totalResults: 40 },
  }));
  assert.ok(many.calls.some((c) => c.method === "step" && c.value === "2 of 40 geo"));
  assert.ok(many.calls.some((c) => c.method === "info" && c.value === "`Paris, France`  FR|IDF|Paris"));
});
