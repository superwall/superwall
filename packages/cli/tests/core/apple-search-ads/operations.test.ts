import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuperwallApi } from "@/core/api/client";
import type { Session } from "@/core/account/storage";
import {
  accountResolver,
  assignField,
  buildQuery,
  buildReport,
  collectPages,
  deepMerge,
  readJsonInput,
  resolveOperation,
  runAsaOperation,
  splitList,
  type AsaPage,
} from "@/core/apple-search-ads/operations";
import { restoreFetch } from "../../helpers/fetch";

afterEach(() => restoreFetch());

const SESSION: Session = {
  apiKey: "sk_x",
  host: "https://api.example.com",
  createdAt: "n",
};
const api = createSuperwallApi(SESSION).forOrg("77");

interface Call {
  url: string;
  method?: string;
  body?: unknown;
  headers: Record<string, string>;
}

function record(respond: (call: Call) => unknown = () => ({ result: [] })): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const usd = () => Promise.resolve("USD");
const account = { id: () => Promise.resolve("123"), currency: usd };
const opts = { account };
const PROXY = "https://api.example.com/v2/organizations/77/apple-search-ads/proxy/5/v1";

test("readJsonInput accepts inline JSON and @file", () => {
  assert.deepEqual(readJsonInput('{"a":1}', "--body"), { a: 1 });
  const dir = mkdtempSync(join(tmpdir(), "asa-"));
  const file = join(dir, "sel.json");
  writeFileSync(file, '[{"id":1}]');
  assert.deepEqual(readJsonInput(`@${file}`, "--body"), [{ id: 1 }]);
  assert.throws(() => readJsonInput("{nope", "--body"), /Invalid --body/);
});

test("splitList trims comma-separated values", () => {
  assert.deepEqual(splitList(" US, GB ,,CA"), ["US", "GB", "CA"]);
  assert.deepEqual(splitList(undefined), []);
  assert.deepEqual(splitList(["a", " b"]), ["a", "b"]);
});

const run = (group: string, action: string, flags: Record<string, unknown> = {}, rest: { positional?: string; params?: Record<string, unknown> } = {}) => {
  return runAsaOperation(api, "5", { group, action, flags, params: rest.params ?? {}, positional: rest.positional }, opts);
};

test("assignField writes dotted keys without touching siblings, and deepMerge merges objects only", () => {
  const body: Record<string, unknown> = { targeting: { supplySource: { include: ["APPSTORE"] } } };
  assignField(body, "targeting.countryOrRegion.include", ["US"]);
  assignField(body, "name", "x");
  assert.deepEqual(body, { targeting: { supplySource: { include: ["APPSTORE"] }, countryOrRegion: { include: ["US"] } }, name: "x" });
  assignField(body, "name.first", "y");
  assert.deepEqual(body.name, { first: "y" });
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, d: [1] }, { a: { c: 3 }, d: [2] }), { a: { b: 1, c: 3 }, d: [2] });
});

test("buildQuery turns shorthand into v1 filters, sorting and pagination", () => {
  assert.deepEqual(
    buildQuery({ field: "status", op: "equals", values: "ENABLED", orderBy: "name:desc", limit: 10, offset: 5 }),
    {
      filters: [{ field: "status", operator: "EQUALS", value: "ENABLED" }],
      sorting: [{ field: "name", order: "DESC" }],
      pagination: { offset: 5, pageSize: 10 },
    },
  );
  assert.deepEqual(buildQuery({ field: "status", op: "EQUALS", values: "ENABLED,PAUSED" }).filters, [
    { field: "status", operator: "EQUALS", value: ["ENABLED", "PAUSED"] },
  ]);
  assert.deepEqual(buildQuery({ field: "id", op: "in", values: "1" }).filters, [{ field: "id", operator: "IN", value: ["1"] }]);
  assert.deepEqual(buildQuery({ field: "endTime", op: "is_null" }).filters, [{ field: "endTime", operator: "IS_NULL" }]);
  assert.deepEqual(buildQuery({}), {});
  assert.deepEqual(buildQuery({ orderBy: "name", offset: 40 }), {
    sorting: [{ field: "name", order: "ASC" }],
    pagination: { offset: 40, pageSize: 20 },
  });
  assert.throws(() => buildQuery({ field: "x" }), /go together/);
  assert.throws(() => buildQuery({ field: "x", op: "EQUALS" }), /go together/);
  assert.throws(() => buildQuery({ query: "[]" }), /--query must be a JSON object/);
});

test("buildQuery keeps a --query's own filters and paging, then adds scope filters and shorthand", () => {
  assert.deepEqual(
    buildQuery({
      query: '{"filters":[{"field":"name","operator":"LIKE","value":"x"}],"pagination":{"fetchTotalCount":true}}',
      filters: [{ field: "campaignId", operator: "EQUALS", value: 1 }],
      field: "status",
      op: "EQUALS",
      values: "ENABLED",
      fields: "id,name",
      limit: 50,
    }),
    {
      filters: [
        { field: "name", operator: "LIKE", value: "x" },
        { field: "campaignId", operator: "EQUALS", value: 1 },
        { field: "status", operator: "EQUALS", value: "ENABLED" },
      ],
      fields: ["id", "name"],
      pagination: { fetchTotalCount: true, offset: 0, pageSize: 50 },
    },
  );
});

test("buildReport puts the range in timeRange, defaults DAILY, and zones only reports that take a time zone", () => {
  const report = buildReport({ start: "2025-01-01", end: "2025-01-31", groupBy: "countryOrRegion", zoned: true });
  assert.deepEqual(report, {
    timeRange: { start: "2025-01-01", end: "2025-01-31", granularity: "DAILY", timeZone: "UTC" },
    groupBy: ["countryOrRegion"],
  });
  assert.deepEqual(buildReport({ start: "a", end: "b", granularity: "weekly", timeZone: "ORTZ", zoned: true }).timeRange, {
    start: "a",
    end: "b",
    granularity: "WEEKLY",
    timeZone: "ORTZ",
  });
  assert.deepEqual(buildReport({ start: "a", end: "b", zoned: false }).timeRange, { start: "a", end: "b", granularity: "DAILY" });
  const fromQuery = buildReport({ query: { timeRange: { start: "a", end: "b", granularity: "MONTHLY" } }, end: "c", zoned: false });
  assert.deepEqual(fromQuery.timeRange, { start: "a", end: "c", granularity: "MONTHLY" });
  assert.throws(() => buildReport({ start: "a", zoned: true }), /--start and --end/);
});

test("collectPages walks v1 result pages by totalCount, then by short pages", async () => {
  const pages: AsaPage[] = [
    { result: [1, 2], pagination: { totalCount: 3 } },
    { result: [3], pagination: { totalCount: 3 } },
  ];
  const seen: number[] = [];
  const res = await collectPages(
    async (offset) => {
      seen.push(offset);
      return pages.shift() ?? { result: [] };
    },
    0,
    2,
  );
  assert.deepEqual(res.result, [1, 2, 3]);
  assert.deepEqual(seen, [0, 2]);

  const short = await collectPages(async () => ({ result: [1] }), 0, 10);
  assert.deepEqual(short.result, [1]);
  const empty = await collectPages(async () => ({ result: [] }), 4, 10);
  assert.deepEqual(empty, {
    result: [],
    pagination: { offset: 4, pageSize: 0, totalCount: 0 },
  });
});

test("resolveOperation validates groups, actions and positionals", () => {
  assert.throws(() => resolveOperation({ group: "nope", action: "list", flags: {}, params: {} }), /Unknown "asa nope"/);
  assert.throws(() => resolveOperation({ group: "campaigns", action: "fly", flags: {}, params: {} }), /Actions: list/);
  assert.throws(() => resolveOperation({ group: "campaigns", action: "get", flags: {}, params: {} }), /needs an id/);
  assert.throws(() => resolveOperation({ group: "keywords", action: "update", flags: {}, params: {} }), /needs an id/);
  assert.throws(() => resolveOperation({ group: "apps", action: "get", flags: {}, params: {} }), /adamId/);
  const { op, scope } = resolveOperation({ group: "apps", action: "get", positional: "42", flags: {}, params: {} });
  assert.equal(op.path, "/apps/{adamId}");
  assert.equal(scope.adamId, "42");
  const bulk = resolveOperation({ group: "keywords", action: "update", flags: {}, params: {} }, [{ id: 1, status: "PAUSED" }]);
  assert.equal(bulk.op.path, "/keywords/bulk-update");
  const items = resolveOperation({ group: "keywords", action: "create", flags: {}, params: {} }, { items: [] });
  assert.equal(items.op.path, "/keywords/bulk-create");
  const single = resolveOperation({ group: "keywords", action: "create", flags: {}, params: {} }, { text: "a" });
  assert.equal(single.op.path, "/keywords");
});

test("campaigns list posts a v1 query with the ad account context header", async () => {
  const calls = record();
  await runAsaOperation(
    api,
    "5",
    { group: "campaigns", action: "list", flags: { limit: 5, field: "status", op: "EQUALS", values: "ENABLED", orderBy: "name:desc" }, params: {} },
    { adAccountId: "99", account },
  );
  assert.equal(calls[0]!.url, `${PROXY}/campaigns/query`);
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    filters: [{ field: "status", operator: "EQUALS", value: "ENABLED" }],
    sorting: [{ field: "name", order: "DESC" }],
    pagination: { offset: 0, pageSize: 5 },
  });
  assert.equal(calls[0]!.headers["x-ap-context"], "adAccountId=99");
});

test("--campaign and --adgroup become filters on the top-level keyword query, not a nested path", async () => {
  const calls = record();
  await run("keywords", "list", { campaign: "123", adgroup: "456" });
  assert.equal(calls[0]!.url, `${PROXY}/keywords/query`);
  assert.deepEqual(calls[0]!.body, {
    filters: [
      { field: "campaignId", operator: "EQUALS", value: 123 },
      { field: "adGroupId", operator: "EQUALS", value: 456 },
    ],
  });
  await run("adgroups", "list", { campaign: "123", adgroup: "456" });
  assert.deepEqual(calls[1]!.body, { filters: [{ field: "campaignId", operator: "EQUALS", value: 123 }] });
  await run("campaigns", "list", { campaign: "123" });
  assert.deepEqual(calls[2]!.body, {});
});

test("--all re-posts the query page by page, asking Apple for the total", async () => {
  const calls = record((call) => {
    const body = call.body as { pagination: { offset: number } };
    return body.pagination.offset === 0
      ? { result: [{ id: 1 }], pagination: { totalCount: 2 } }
      : { result: [{ id: 2 }], pagination: { totalCount: 2 } };
  });
  const res = await run("campaigns", "list", { field: "status", op: "EQUALS", values: "ENABLED", all: true, limit: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual((calls[0]!.body as { filters: unknown }).filters, [{ field: "status", operator: "EQUALS", value: "ENABLED" }]);
  assert.deepEqual((calls[1]!.body as { pagination: unknown }).pagination, { offset: 1, pageSize: 1, fetchTotalCount: true });
  assert.deepEqual(res.response.result, [{ id: 1 }, { id: 2 }]);
});

test("--all without --limit pages a thousand at a time, and a page without rows ends the walk", async () => {
  const calls = record(() => ({ result: { not: "rows" } }));
  const res = await run("campaigns", "list", { all: true });
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0]!.body as { pagination: unknown }).pagination, { offset: 0, pageSize: 1000, fetchTotalCount: true });
  assert.deepEqual(res.response.result, []);
});

test("campaigns create builds Apple's nested body from typed flags, money, lists, defaults and -d", async () => {
  const calls = record(() => ({ result: { id: 1 } }));
  await run(
    "campaigns",
    "create",
    {
      name: "Launch",
      adamId: "42",
      countries: "US, GB",
      dailyBudget: "50",
      supplyPlacements: "APPSTORE_SEARCH_RESULTS",
      billingEvent: "TAPS",
      bidStrategy: "MANUAL_CPT",
      bidGoal: "TAP",
      status: "PAUSED",
    },
    { params: { targeting: { supplySource: { include: ["APPSTORE"] } } } },
  );
  assert.equal(calls[0]!.url, `${PROXY}/campaigns`);
  assert.deepEqual(calls[0]!.body, {
    promotedObjectType: "APPSTORE_APP",
    name: "Launch",
    promotedObjectId: "42",
    billingEvent: "TAPS",
    targeting: {
      countryOrRegion: { include: ["US", "GB"] },
      supplyPlacement: { include: ["APPSTORE_SEARCH_RESULTS"] },
      supplySource: { include: ["APPSTORE"] },
    },
    dailyBudget: { value: { amount: "50", currency: "USD" } },
    bidStrategy: { bidStrategyType: "MANUAL_CPT", bidStrategyGoal: "TAP" },
    status: "PAUSED",
    adAccountId: 123,
  });
});

test("create keeps an ad account the body names, and budget orders get the account as a list", async () => {
  const calls = record(() => ({ result: { id: 1 } }));
  await run("campaigns", "create", { body: '{"adAccountId":7,"promotedObjectType":"BUSINESS_BRAND"}', name: "x" });
  assert.deepEqual(calls[0]!.body, { promotedObjectType: "BUSINESS_BRAND", adAccountId: 7, name: "x" });
  await run("budget-orders", "create", { name: "Q3", amount: "100", start: "2026-07-01T00:00:00.000" });
  assert.equal(calls[1]!.url, `${PROXY}/shared-budgets`);
  assert.deepEqual(calls[1]!.body, {
    name: "Q3",
    startTime: "2026-07-01T00:00:00.000",
    value: { amount: "100", currency: "USD" },
    adAccountIds: [123],
  });
});

test("update puts the body as is at the top-level path, with --body under the flags", async () => {
  const calls = record(() => ({ result: { id: 8 } }));
  await run("campaigns", "update", { body: '{"name":"Old","status":"ENABLED"}', status: "PAUSED" }, { positional: "8" });
  assert.equal(calls[0]!.url, `${PROXY}/campaigns/8`);
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, { name: "Old", status: "PAUSED" });
  await run("adgroups", "update", { bid: "1.5" }, { positional: "9" });
  assert.equal(calls[1]!.url, `${PROXY}/adgroups/9`);
  assert.deepEqual(calls[1]!.body, { bidStrategy: { bid: { amount: "1.5", currency: "USD" } } });
});

test("keywords create sends one keyword, or bulk items with correlation ids for an array", async () => {
  const calls = record(() => ({ result: [] }));
  await run("keywords", "create", { adgroup: "456", text: "photo editor", matchType: "EXACT", bid: "2.5", status: "ENABLED" });
  assert.equal(calls[0]!.url, `${PROXY}/keywords`);
  assert.deepEqual(calls[0]!.body, {
    adGroupId: 456,
    text: "photo editor",
    matchType: "EXACT",
    bid: { amount: "2.5", currency: "USD" },
    status: "ENABLED",
  });
  await run("keywords", "create", { body: [{ adGroupId: 456, text: "a" }, { correlationId: 9, data: { adGroupId: 456, text: "b" } }] });
  assert.equal(calls[1]!.url, `${PROXY}/keywords/bulk-create`);
  assert.deepEqual(calls[1]!.body, {
    items: [
      { correlationId: 0, data: { adGroupId: 456, text: "a" } },
      { correlationId: 9, data: { adGroupId: 456, text: "b" } },
    ],
  });
  const items = { items: [{ correlationId: 0, data: { text: "c" } }] };
  await run("negative-keywords", "create", { body: items });
  assert.equal(calls[2]!.url, `${PROXY}/negative-keywords/bulk-create`);
  assert.deepEqual(calls[2]!.body, items);
});

test("keywords update and delete hit the single endpoint for one id and the bulk one for several", async () => {
  const calls = record(() => ({ result: [] }));
  await run("keywords", "update", { status: "PAUSED" }, { positional: "1" });
  assert.equal(calls[0]!.url, `${PROXY}/keywords/1`);
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, { status: "PAUSED" });
  await run("keywords", "update", { status: "PAUSED", bid: "3" }, { positional: "1,kw-2" });
  assert.equal(calls[1]!.url, `${PROXY}/keywords/bulk-update`);
  assert.deepEqual(calls[1]!.body, {
    items: [
      { correlationId: 0, data: { bid: { amount: "3", currency: "USD" }, status: "PAUSED", id: 1 } },
      { correlationId: 1, data: { bid: { amount: "3", currency: "USD" }, status: "PAUSED", id: "kw-2" } },
    ],
  });
  await run("keywords", "delete", {}, { positional: "5" });
  assert.equal(calls[2]!.url, `${PROXY}/keywords/5`);
  assert.equal(calls[2]!.method, "DELETE");
  await run("negative-keywords", "delete", {}, { positional: "5,6" });
  assert.equal(calls[3]!.url, `${PROXY}/negative-keywords/bulk-delete`);
  assert.deepEqual(calls[3]!.body, {
    items: [
      { correlationId: 0, data: { id: 5 } },
      { correlationId: 1, data: { id: 6 } },
    ],
  });
  await run("keywords", "delete", { body: [{ id: 7 }] });
  assert.deepEqual(calls[4]!.body, { items: [{ correlationId: 0, data: { id: 7 } }] });
});

test("bulk bodies refuse a scalar body or nothing to send", async () => {
  const calls = record(() => ({ result: [] }));
  await assert.rejects(run("keywords", "update", { body: "3" }, { positional: "1,2" }), {
    message: "--body must be a JSON array (or one object) for this command.",
  });
  await assert.rejects(run("keywords", "create", { body: "3" }), { message: "--body must be a JSON object for this command." });
  await assert.rejects(run("keywords", "update", {}, { positional: "1,2" }), {
    message: "Nothing to send. Pass fields (--bid, --status) or --body '[...]'.",
  });
  await run("keywords", "update", { body: { status: "PAUSED" } }, { positional: "1,2" });
  assert.deepEqual(calls[0]!.body, {
    items: [
      { correlationId: 0, data: { status: "PAUSED", id: 1 } },
      { correlationId: 1, data: { status: "PAUSED", id: 2 } },
    ],
  });
  const { op } = resolveOperation({ group: "keywords", action: "create", flags: {}, params: {} }, [{}]);
  assert.equal(op.body, "bulk");
});

test("reports post a v1 reporting request, scoped by campaign filters", async () => {
  const calls = record(() => ({ result: [] }));
  await run("reports", "keywords", { campaign: "444", adgroup: "555", start: "2025-01-01", end: "2025-01-31", groupBy: "countryOrRegion", limit: 20 });
  assert.equal(calls[0]!.url, `${PROXY}/reports/apps/keywords/query`);
  assert.deepEqual(calls[0]!.body, {
    filters: [
      { field: "campaignId", operator: "EQUALS", value: "444" },
      { field: "adGroupId", operator: "EQUALS", value: "555" },
    ],
    pagination: { offset: 0, pageSize: 20 },
    timeRange: { start: "2025-01-01", end: "2025-01-31", granularity: "DAILY", timeZone: "UTC" },
    groupBy: ["countryOrRegion"],
  });
  await assert.rejects(run("reports", "keywords", { start: "a", end: "b" }), { message: "asa reports keywords needs --campaign <id>." });
  await run("brand-reports", "campaigns", { start: "a", end: "b" });
  assert.equal(calls[1]!.url, `${PROXY}/reports/business-brands/campaigns/query`);
  await run("insights", "impression-share", { adamId: "42", start: "a", end: "b", query: { options: { impressionShareReportType: "FIRST_SLOT" } } });
  assert.equal(calls[2]!.url, `${PROXY}/insights/apps/impression-share/query`);
  assert.deepEqual(calls[2]!.body, {
    options: { impressionShareReportType: "FIRST_SLOT" },
    filters: [{ field: "promotedObjectId", operator: "EQUALS", value: "42" }],
    timeRange: { start: "a", end: "b", granularity: "DAILY" },
  });
});

test("geo get posts a geoRequest with the supply source, and needs --entity", async () => {
  const calls = record(() => ({ result: [] }));
  await run("geo", "get", { entity: "Locality" }, { positional: "1,2" });
  assert.equal(calls[0]!.url, `${PROXY}/search/geo`);
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    geoRequest: [
      { id: "1", entity: "Locality" },
      { id: "2", entity: "Locality" },
    ],
    supplySource: "APPSTORE",
  });
  await run("geo", "get", { entity: "Country", supplySource: "MAPS", limit: 5 }, { positional: "1" });
  assert.deepEqual(calls[1]!.body, { geoRequest: [{ id: "1", entity: "Country" }], supplySource: "MAPS", pagination: { offset: 0, pageSize: 5 } });
  await assert.rejects(run("geo", "get", {}, { positional: "1" }), /needs --entity/);
});

test("apps search and geo search put the query in the URL, and geo pages by pageSize", async () => {
  const calls = record(() => ({ result: [{ id: 1 }], pagination: { totalCount: 1 } }));
  await run("apps", "search", { owned: true, storeFronts: "US", limit: 3 }, { positional: "maps" });
  assert.equal(calls[0]!.url, `${PROXY}/search/apps?query=maps&returnOwnedApps=true&storeFronts=US&limit=3`);
  await run("geo", "search", { country: "US", entity: "Locality", all: true, limit: 10 }, { positional: "San Francisco" });
  assert.equal(
    calls[1]!.url,
    `${PROXY}/search/geo?supplySource=APPSTORE&query=San+Francisco&countrycode=US&entity=Locality&pageSize=10&offset=0`,
  );
  await run("geo", "search", { supplySource: "MAPS" }, { positional: "x" });
  assert.equal(calls[2]!.url, `${PROXY}/search/geo?supplySource=MAPS&query=x`);
  await assert.rejects(run("apps", "search"), /needs a search query/);
  await assert.rejects(run("apps", "search", {}, { positional: "x", params: { a: { b: 1 } } }), /Nested -d params/);
  await run("apps", "search", {}, { positional: "x", params: { cpids: "1" } });
  assert.equal(calls[3]!.url, `${PROXY}/search/apps?query=x&cpids=1`);
});

test("app-scoped queries filter by the app or the positional id, and fill the path when it names the app", async () => {
  const calls = record(() => ({ result: [] }));
  await run("apps", "eligibility", {}, { positional: "42" });
  assert.equal(calls[0]!.url, `${PROXY}/eligibilities/apps/query`);
  assert.deepEqual(calls[0]!.body, { filters: [{ field: "adamId", operator: "EQUALS", value: 42 }] });
  await run("apps", "localized", {}, { positional: "42" });
  assert.equal(calls[1]!.url, `${PROXY}/apps/42/locale-details/query`);
  await run("product-pages", "locales", {}, { positional: "133fc807" });
  assert.deepEqual(calls[2]!.body, { filters: [{ field: "productPageId", operator: "EQUALS", value: "133fc807" }] });
  await run("product-pages", "list", { adamId: "42" });
  assert.deepEqual(calls[3]!.body, { filters: [{ field: "adamId", operator: "EQUALS", value: 42 }] });
  await run("suggestions", "keywords", { adamId: "42" });
  assert.equal(calls[4]!.url, `${PROXY}/suggestions/keywords/query`);
  assert.deepEqual(calls[4]!.body, { filters: [{ field: "promotedObjectId", operator: "EQUALS", value: ["42"] }] });
  await assert.rejects(run("product-pages", "list"), { message: "asa product-pages list needs --adam-id <id>." });
});

test("recommendations apply and dismiss send the array Apple documents, and need --body", async () => {
  const calls = record(() => ({ result: [] }));
  const recommendation = { id: "rec-1", promotedObjectId: "42", promotedObjectType: "APPSTORE_APP" };
  await run("recommendations", "apply-target-cpas", { body: [recommendation] });
  assert.equal(calls[0]!.url, `${PROXY}/recommendations/target-cpas/apply`);
  assert.deepEqual(calls[0]!.body, [recommendation]);
  await run("recommendations", "dismiss-daily-budgets", { body: recommendation });
  assert.deepEqual(calls[1]!.body, [recommendation]);
  await assert.rejects(run("recommendations", "apply-daily-budgets"), {
    message: "asa recommendations apply-daily-budgets needs --body '[...]', as Apple documents it.",
  });
});

test("GET reads take their own query params: change history paging and advertiser resources", async () => {
  const calls = record(() => ({ result: [] }));
  await run("change-history", "get", { limit: 5, offset: 10 }, { positional: "Campaign.1.txn" });
  assert.equal(calls[0]!.url, `${PROXY}/change-history/Campaign.1.txn?limit=5&offset=10`);
  await run("ad-accounts", "resources", { resourceType: "CONTENT_PROVIDER" });
  assert.equal(calls[1]!.url, `${PROXY}/advertiser-resources?resourceType=CONTENT_PROVIDER`);
  await run("campaigns", "limited-reasons", {}, { positional: "3" });
  assert.equal(calls[2]!.url, `${PROXY}/campaigns/3/legacy-app-limited-status-reason-details`);
});

test("delete with no body returns an ok marker when the proxy answers 204", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const res = await run("campaigns", "delete", {}, { positional: "3" });
  assert.deepEqual(res.response, { result: null });
  assert.equal(res.path, "/campaigns/3");
});

test("me and acls are plain reads", async () => {
  const calls = record(() => ({ result: { userId: 1 } }));
  await run("me", "get");
  assert.equal(calls[0]!.url, `${PROXY}/me`);
  await run("acls", "list");
  assert.equal(calls[1]!.url, `${PROXY}/acls`);
});

test("typed flags convert booleans, skip empty values, and refuse a bad number", async () => {
  const calls = record(() => ({ result: { id: 1 } }));
  await run("adgroups", "create", { name: "", searchMatch: true, status: null });
  assert.deepEqual(calls[0]!.body, { automatedKeywordsOptIn: true });
  await run("adgroups", "create", { campaign: "1", searchMatch: "no" });
  assert.deepEqual(calls[1]!.body, { campaignId: 1, automatedKeywordsOptIn: false });
  await assert.rejects(run("ads", "create", { creativeId: "abc" }), { message: "--creative-id must be a number." });
  await assert.rejects(run("campaigns", "create", { body: "[1]" }), { message: "--body must be a JSON object for this command." });
  assert.equal(calls.length, 2);
});

const acls = (...adAccounts: unknown[]) => ({ result: { acls: adAccounts.map((adAccount) => ({ adAccount, roles: ["Admin"] })) } });

test("accountResolver currency honours --currency, then the ad account the ACL list names", async () => {
  assert.equal(await accountResolver(api, "5", "usd", undefined).currency(), "USD");

  const single = record(() => acls({ id: 1, currency: "eur" }));
  const resolved = accountResolver(api, "5", undefined, undefined);
  assert.equal(await resolved.currency(), "EUR");
  assert.equal(await resolved.currency(), "EUR");
  assert.equal(await resolved.id(), "1");
  assert.equal(single.length, 1);
  assert.equal(single[0]!.url, `${PROXY}/acls`);
  assert.equal(single[0]!.headers["x-ap-context"], undefined);

  record(() => acls({ id: 1, currency: "EUR" }, { id: 2, currency: "USD" }));
  assert.equal(await accountResolver(api, "5", undefined, "2").currency(), "USD");
  await assert.rejects(accountResolver(api, "5", undefined, undefined).currency(), {
    message: "This API user reaches several ad accounts (1, 2). Pass --ad-account-id or --currency.",
  });
  await assert.rejects(accountResolver(api, "5", undefined, "3").currency(), {
    message: "This API user can't reach ad account 3. It reaches: 1, 2. Pass --currency (e.g. USD) to skip the lookup.",
  });

  record(() => ({ result: { acls: [] } }));
  await assert.rejects(accountResolver(api, "5", undefined, undefined).currency(), {
    message: "This API user can't reach any Apple Ads ad account. Pass --currency (e.g. USD).",
  });
  await assert.rejects(accountResolver(api, "5", undefined, "3").currency(), {
    message: "This API user can't reach ad account 3. Pass --currency (e.g. USD) to skip the lookup.",
  });
});

test("accountResolver id uses --ad-account-id as given, or the only account the API user reaches", async () => {
  const calls = record(() => acls({ id: 1 }, { id: 2 }));
  assert.equal(await accountResolver(api, "5", undefined, "9").id(), "9");
  assert.equal(calls.length, 0);
  await assert.rejects(accountResolver(api, "5", undefined, undefined).id(), {
    message: "This API user reaches several ad accounts (1, 2). Pass --ad-account-id.",
  });
  record(() => ({ result: { acls: [] } }));
  await assert.rejects(accountResolver(api, "5", undefined, undefined).id(), {
    message: "This API user can't reach any Apple Ads ad account.",
  });
});

test("accountResolver reads the ad account itself when the ACL list leaves its currency out", async () => {
  const calls = record((call) => {
    return call.url.endsWith("/acls")
      ? { result: { acls: [{ adAccount: { id: 123456789, name: "AwayFinder", orgId: 27154130 } }] } }
      : { result: { id: 123456789, currency: "GBP" } };
  });
  assert.equal(await accountResolver(api, "5", undefined, undefined).currency(), "GBP");
  assert.equal(calls[1]!.url, `${PROXY}/ad-accounts/123456789`);
  assert.equal(calls[1]!.method, "GET");
  assert.equal(calls[1]!.headers["x-ap-context"], "adAccountId=123456789");
});

test("accountResolver can't tell the currency from an ACL answer without accounts or an account without one", async () => {
  record(() => ({ result: { orgId: 1 } }));
  await assert.rejects(accountResolver(api, "5", undefined, undefined).currency(), /can't reach any Apple Ads ad account/);
  record(() => ({ result: { acls: [{ adAccount: { id: 7 } }, { roles: [] }, "x"] } }));
  await assert.rejects(accountResolver(api, "5", undefined, "7").currency(), {
    message: "Couldn't read ad account 7's currency from Apple Ads. Pass --currency (e.g. USD).",
  });
});
