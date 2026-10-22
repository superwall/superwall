import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuperwallApi } from "@/core/api/client";
import type { Session } from "@/core/account/storage";
import {
  buildReport,
  buildSelector,
  collectPages,
  currencyResolver,
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

function record(respond: (call: Call) => unknown = () => ({ data: [] })): Call[] {
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
const PROXY = "https://api.example.com/v2/organizations/77/apple-search-ads/proxy/5/api/v5";

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

test("buildSelector composes shorthand, ordering, fields and paging", () => {
  assert.deepEqual(
    buildSelector({
      field: "status",
      op: "equals",
      values: "ENABLED,PAUSED",
      orderBy: "name:desc",
      fields: "id,name",
      limit: 10,
      offset: 5,
    }),
    {
      conditions: [{ field: "status", operator: "EQUALS", values: ["ENABLED", "PAUSED"] }],
      orderBy: [{ field: "name", sortOrder: "DESCENDING" }],
      fields: ["id", "name"],
      pagination: { offset: 5, limit: 10 },
    },
  );
  assert.deepEqual(buildSelector({}), {});
  assert.deepEqual(buildSelector({ selector: '{"conditions":[]}', orderBy: "name" }), {
    conditions: [],
    orderBy: [{ field: "name", sortOrder: "ASCENDING" }],
  });
  assert.throws(() => buildSelector({ field: "x" }), /go together/);
  assert.throws(() => buildSelector({ selector: "[]" }), /JSON object/);
});

test("buildReport defaults granularity except for search terms", () => {
  const campaigns = buildReport({ start: "2025-01-01", end: "2025-01-31", searchTerms: false });
  assert.equal(campaigns.granularity, "DAILY");
  assert.equal(campaigns.timeZone, "UTC");
  assert.deepEqual(campaigns.selector, {
    orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }],
  });
  const terms = buildReport({
    start: "2025-01-01",
    end: "2025-01-31",
    searchTerms: true,
    groupBy: "countryOrRegion",
  });
  assert.equal("granularity" in terms, false);
  assert.deepEqual(terms.groupBy, ["countryOrRegion"]);
  const weekly = buildReport({
    start: "a",
    end: "b",
    searchTerms: true,
    granularity: "weekly",
    selector: '{"conditions":[]}',
  });
  assert.equal(weekly.granularity, "WEEKLY");
  assert.deepEqual(weekly.selector, { conditions: [] });
  assert.throws(() => buildReport({ start: "a", searchTerms: false }), /--start and --end/);
});

test("collectPages walks by totalResults, then by short pages", async () => {
  const pages: AsaPage[] = [
    { data: [1, 2], pagination: { totalResults: 3 } },
    { data: [3], pagination: { totalResults: 3 } },
  ];
  const seen: number[] = [];
  const res = await collectPages(
    async (offset) => {
      seen.push(offset);
      return pages.shift() ?? { data: [] };
    },
    0,
    2,
  );
  assert.deepEqual(res.data, [1, 2, 3]);
  assert.deepEqual(seen, [0, 2]);

  const short = await collectPages(async () => ({ data: [1] }), 0, 10);
  assert.deepEqual(short.data, [1]);
  const empty = await collectPages(async () => ({ data: [] }), 4, 10);
  assert.deepEqual(empty, {
    data: [],
    pagination: { totalResults: 0, startIndex: 4, itemsPerPage: 0 },
  });
});

test("resolveOperation validates groups, actions and positionals", () => {
  assert.throws(
    () => resolveOperation({ group: "nope", action: "list", flags: {}, params: {} }),
    /Unknown "asa nope"/,
  );
  assert.throws(
    () => resolveOperation({ group: "campaigns", action: "fly", flags: {}, params: {} }),
    /Actions: list/,
  );
  assert.throws(
    () => resolveOperation({ group: "campaigns", action: "get", flags: {}, params: {} }),
    /needs an id/,
  );
  assert.throws(
    () => resolveOperation({ group: "apps", action: "get", flags: {}, params: {} }),
    /adamId/,
  );
  const { op, scope } = resolveOperation({
    group: "apps",
    action: "get",
    positional: "42",
    flags: {},
    params: {},
  });
  assert.equal(op.path, "/apps/{adamId}");
  assert.equal(scope.adamId, "42");
});

test("list operations send query params and the org context header", async () => {
  const calls = record();
  await runAsaOperation(
    api,
    "5",
    { group: "campaigns", action: "list", flags: { limit: 5, fields: "id,name" }, params: {} },
    { orgId: "99", currency: usd },
  );
  assert.equal(calls[0]!.url, `${PROXY}/campaigns?fields=id%2Cname&limit=5`);
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.headers["x-ap-context"], "orgId=99");
});

test("--all pages a GET list with offset/limit", async () => {
  const calls = record((call) =>
    call.url.includes("offset=0")
      ? { data: [{ id: 1 }, { id: 2 }], pagination: { totalResults: 3 } }
      : { data: [{ id: 3 }], pagination: { totalResults: 3 } },
  );
  const res = await runAsaOperation(
    api,
    "5",
    { group: "campaigns", action: "list", flags: { all: true, limit: 2 }, params: {} },
    { currency: usd },
  );
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.url.includes("offset=2"));
  assert.deepEqual(res.response.data, [{ id: 1 }, { id: 2 }, { id: 3 }]);
});

test("find sends a selector, and --all re-pages it", async () => {
  const calls = record((call) => {
    const body = call.body as { pagination: { offset: number } };
    return body.pagination.offset === 0
      ? { data: [{ id: 1 }], pagination: { totalResults: 2 } }
      : { data: [{ id: 2 }], pagination: { totalResults: 2 } };
  });
  const res = await runAsaOperation(
    api,
    "5",
    {
      group: "campaigns",
      action: "find",
      flags: { field: "status", op: "EQUALS", values: "ENABLED", all: true, limit: 1 },
      params: {},
    },
    { currency: usd },
  );
  assert.equal(calls[0]!.url, `${PROXY}/campaigns/find`);
  assert.deepEqual((calls[0]!.body as { conditions: unknown }).conditions, [
    { field: "status", operator: "EQUALS", values: ["ENABLED"] },
  ]);
  assert.deepEqual((calls[1]!.body as { pagination: unknown }).pagination, { offset: 1, limit: 1 });
  assert.equal((res.response.data as unknown[]).length, 2);
});

test("create builds the body from typed flags, money, lists and -d", async () => {
  const calls = record(() => ({ data: { id: 1 } }));
  await runAsaOperation(
    api,
    "5",
    {
      group: "campaigns",
      action: "create",
      flags: {
        name: "Launch",
        adamId: "123",
        countries: "US,GB",
        dailyBudget: "50",
        status: "ENABLED",
      },
      params: { supplySources: ["APPSTORE_SEARCH_RESULTS"] },
    },
    { currency: usd },
  );
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    name: "Launch",
    adamId: 123,
    countriesOrRegions: ["US", "GB"],
    dailyBudgetAmount: { amount: "50", currency: "USD" },
    status: "ENABLED",
    supplySources: ["APPSTORE_SEARCH_RESULTS"],
  });
});

test("update wraps the campaign envelope and --body merges under flags", async () => {
  const calls = record(() => ({ data: { id: 1 } }));
  await runAsaOperation(
    api,
    "5",
    {
      group: "campaigns",
      action: "update",
      positional: "8",
      flags: { status: "PAUSED", body: '{"name":"Old"}' },
      params: {},
    },
    { currency: usd },
  );
  assert.equal(calls[0]!.method, "PUT");
  assert.equal(calls[0]!.url, `${PROXY}/campaigns/8`);
  assert.deepEqual(calls[0]!.body, { campaign: { name: "Old", status: "PAUSED" } });
});

test("bulk keyword commands send arrays and pick the right delete endpoint", async () => {
  const calls = record(() => ({ data: [] }));
  const scope = { campaign: "1", adgroup: "2" };
  await runAsaOperation(
    api,
    "5",
    {
      group: "keywords",
      action: "create",
      flags: { ...scope, text: "grammar", matchType: "EXACT", bid: "1.5" },
      params: {},
    },
    { currency: usd },
  );
  assert.deepEqual(calls[0]!.body, [
    { text: "grammar", matchType: "EXACT", bidAmount: { amount: "1.5", currency: "USD" } },
  ]);
  assert.ok(calls[0]!.url.endsWith("/targetingkeywords/bulk"));

  await runAsaOperation(
    api,
    "5",
    {
      group: "keywords",
      action: "update",
      positional: "77",
      flags: { ...scope, status: "PAUSED" },
      params: {},
    },
    { currency: usd },
  );
  assert.deepEqual(calls[1]!.body, [{ status: "PAUSED", id: 77 }]);
  assert.equal(calls[1]!.method, "PUT");

  await runAsaOperation(
    api,
    "5",
    {
      group: "keywords",
      action: "update",
      flags: { ...scope, body: '[{"id":1},{"id":2}]' },
      params: {},
    },
    { currency: usd },
  );
  assert.deepEqual(calls[2]!.body, [{ id: 1 }, { id: 2 }]);

  await runAsaOperation(
    api,
    "5",
    { group: "keywords", action: "delete", positional: "9", flags: scope, params: {} },
    { currency: usd },
  );
  assert.equal(calls[3]!.method, "DELETE");
  assert.ok(calls[3]!.url.endsWith("/targetingkeywords/9"));

  await runAsaOperation(
    api,
    "5",
    { group: "keywords", action: "delete", positional: "9,10", flags: scope, params: {} },
    { currency: usd },
  );
  assert.equal(calls[4]!.method, "POST");
  assert.deepEqual(calls[4]!.body, [9, 10]);

  await assert.rejects(
    runAsaOperation(
      api,
      "5",
      { group: "keywords", action: "create", flags: scope, params: {} },
      { currency: usd },
    ),
    /Nothing to send/,
  );
  await assert.rejects(
    runAsaOperation(
      api,
      "5",
      { group: "keywords", action: "create", flags: { ...scope, body: '"x"' }, params: {} },
      { currency: usd },
    ),
    /JSON array/,
  );
});

test("reports post Apple's reporting request to the scoped path", async () => {
  const calls = record(() => ({ data: { reportingDataResponse: {} } }));
  await runAsaOperation(
    api,
    "5",
    {
      group: "reports",
      action: "keywords",
      flags: {
        campaign: "1",
        adgroup: "2",
        start: "2025-01-01",
        end: "2025-01-31",
        groupBy: "countryOrRegion",
      },
      params: {},
    },
    { currency: usd },
  );
  assert.equal(calls[0]!.url, `${PROXY}/reports/campaigns/1/adgroups/2/keywords`);
  const body = calls[0]!.body as Record<string, unknown>;
  assert.equal(body.startTime, "2025-01-01");
  assert.equal(body.granularity, "DAILY");
  assert.deepEqual(body.groupBy, ["countryOrRegion"]);
});

test("geo get posts id/entity pairs and needs --entity", async () => {
  const calls = record(() => ({ data: [] }));
  await runAsaOperation(
    api,
    "5",
    {
      group: "geo",
      action: "get",
      positional: "US|CA|Cupertino",
      flags: { entity: "Locality" },
      params: {},
    },
    { currency: usd },
  );
  assert.deepEqual(calls[0]!.body, [{ id: "US|CA|Cupertino", entity: "Locality" }]);
  await assert.rejects(
    runAsaOperation(
      api,
      "5",
      { group: "geo", action: "get", positional: "US", flags: {}, params: {} },
      { currency: usd },
    ),
    /--entity/,
  );
});

test("apps search and geo search put the query in the URL", async () => {
  const calls = record();
  await runAsaOperation(
    api,
    "5",
    {
      group: "apps",
      action: "search",
      positional: "grammar checker",
      flags: { owned: true },
      params: {},
    },
    { currency: usd },
  );
  assert.equal(calls[0]!.url, `${PROXY}/search/apps?query=grammar+checker&returnOwnedApps=true`);
  await runAsaOperation(
    api,
    "5",
    {
      group: "geo",
      action: "search",
      positional: "New York",
      flags: { country: "US", entity: "Locality" },
      params: {},
    },
    { currency: usd },
  );
  assert.equal(calls[1]!.url, `${PROXY}/search/geo?query=New+York&countrycode=US&entity=Locality`);
  await assert.rejects(
    runAsaOperation(
      api,
      "5",
      { group: "apps", action: "search", flags: {}, params: {} },
      { currency: usd },
    ),
    /search query/,
  );
});

test("adam-id scoped reads fill the path from the flag or positional", async () => {
  const calls = record();
  await runAsaOperation(
    api,
    "5",
    {
      group: "product-pages",
      action: "list",
      flags: { adamId: "42", states: "VISIBLE" },
      params: { extra: "1" },
    },
    { currency: usd },
  );
  assert.equal(calls[0]!.url, `${PROXY}/apps/42/product-pages?states=VISIBLE&extra=1`);
  await runAsaOperation(
    api,
    "5",
    { group: "apps", action: "eligibility", positional: "42", flags: {}, params: {} },
    { currency: usd },
  );
  assert.equal(calls[1]!.url, `${PROXY}/apps/42/eligibilities/find`);
  assert.deepEqual(calls[1]!.body, {});
  await assert.rejects(
    runAsaOperation(
      api,
      "5",
      { group: "product-pages", action: "list", flags: {}, params: { a: { b: 1 } } },
      { currency: usd },
    ),
    /--adam-id/,
  );
  await assert.rejects(
    runAsaOperation(
      api,
      "5",
      { group: "product-pages", action: "countries", flags: {}, params: { a: { b: 1 } } },
      { currency: usd },
    ),
    /Nested/,
  );
});

test("delete with no body returns an ok marker when the proxy answers 204", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const res = await runAsaOperation(
    api,
    "5",
    { group: "campaigns", action: "delete", positional: "3", flags: {}, params: {} },
    { currency: usd },
  );
  assert.deepEqual(res.response, { data: null });
  assert.equal(res.path, "/campaigns/3");
});

test("me and acls are plain reads", async () => {
  const calls = record(() => ({ data: { userId: 1 } }));
  await runAsaOperation(
    api,
    "5",
    { group: "me", action: "get", flags: {}, params: {} },
    { currency: usd },
  );
  assert.equal(calls[0]!.url, `${PROXY}/me`);
  await runAsaOperation(
    api,
    "5",
    { group: "acls", action: "list", flags: {}, params: {} },
    { currency: usd },
  );
  assert.equal(calls[1]!.url, `${PROXY}/acls`);
});

test("currencyResolver honours --currency, then the ACL list", async () => {
  assert.equal(await currencyResolver(api, "5", "usd", undefined)(), "USD");

  record(() => ({ data: [{ orgId: 1, currency: "EUR" }] }));
  const single = currencyResolver(api, "5", undefined, undefined);
  assert.equal(await single(), "EUR");
  assert.equal(await single(), "EUR");

  record(() => ({
    data: [
      { orgId: 1, currency: "EUR" },
      { orgId: 2, currency: "USD" },
    ],
  }));
  assert.equal(await currencyResolver(api, "5", undefined, "2")(), "USD");
  await assert.rejects(currencyResolver(api, "5", undefined, undefined)(), /several currencies/);

  record(() => ({ data: [] }));
  await assert.rejects(currencyResolver(api, "5", undefined, undefined)(), /Pass --currency/);
});

test("typed flags convert booleans, skip empty values, and refuse a bad number", async () => {
  const calls = record(() => ({ data: { id: 1 } }));
  await runAsaOperation(
    api,
    "5",
    { group: "adgroups", action: "create", flags: { campaign: "1", name: "", searchMatch: true, status: null }, params: {} },
    { currency: usd },
  );
  assert.deepEqual(calls[0]!.body, { automatedKeywordsOptIn: true });
  await runAsaOperation(
    api,
    "5",
    { group: "adgroups", action: "create", flags: { campaign: "1", searchMatch: "no" }, params: {} },
    { currency: usd },
  );
  assert.deepEqual(calls[1]!.body, { automatedKeywordsOptIn: false });
  await assert.rejects(
    runAsaOperation(api, "5", { group: "campaigns", action: "create", flags: { adamId: "abc" }, params: {} }, { currency: usd }),
    { message: "--adam-id must be a number." },
  );
  await assert.rejects(
    runAsaOperation(api, "5", { group: "campaigns", action: "create", flags: { body: "[1]" }, params: {} }, { currency: usd }),
    { message: "--body must be a JSON object for this command." },
  );
  assert.equal(calls.length, 2);
});

test("bulk bodies take one object as a list, keep text ids, and refuse an empty or scalar body", async () => {
  const calls = record(() => ({ data: [] }));
  const scope = { campaign: "1", adgroup: "2" };
  await runAsaOperation(
    api,
    "5",
    { group: "keywords", action: "create", flags: { ...scope, body: '{"text":"one"}' }, params: {} },
    { currency: usd },
  );
  assert.deepEqual(calls[0]!.body, [{ text: "one" }]);
  await runAsaOperation(
    api,
    "5",
    { group: "keywords", action: "update", positional: "kw-1", flags: { ...scope, status: "PAUSED" }, params: {} },
    { currency: usd },
  );
  assert.deepEqual(calls[1]!.body, [{ status: "PAUSED", id: "kw-1" }]);
  await assert.rejects(
    runAsaOperation(api, "5", { group: "keywords", action: "create", flags: { ...scope, body: "3" }, params: {} }, { currency: usd }),
    { message: "--body must be a JSON array (or one object) for this command." },
  );
  await assert.rejects(
    runAsaOperation(api, "5", { group: "keywords", action: "create", flags: scope, params: {} }, { currency: usd }),
    { message: "Nothing to send. Pass fields (--text, --match-type, --bid, --status) or --body '[...]'." },
  );
  assert.equal(calls.length, 2);
});

test("buildSelector adds shorthand to a selector's own conditions and pages from an offset alone", () => {
  assert.deepEqual(
    buildSelector({
      selector: '{"conditions":[{"field":"name","operator":"CONTAINS","values":["x"]}]}',
      field: "status",
      op: "in",
      values: "ENABLED,PAUSED",
      offset: 40,
    }),
    {
      conditions: [
        { field: "name", operator: "CONTAINS", values: ["x"] },
        { field: "status", operator: "IN", values: ["ENABLED", "PAUSED"] },
      ],
      pagination: { offset: 40, limit: 20 },
    },
  );
});

test("--all without --limit pages a thousand at a time, and a page without rows ends the walk", async () => {
  const find = record(() => ({ data: [{ id: 1 }], pagination: { totalResults: 1 } }));
  await runAsaOperation(api, "5", { group: "campaigns", action: "find", flags: { all: true }, params: {} }, { currency: usd });
  assert.deepEqual((find[0]!.body as { pagination: unknown }).pagination, { offset: 0, limit: 1000 });

  const list = record(() => ({ data: { not: "rows" } }));
  const res = await runAsaOperation(api, "5", { group: "campaigns", action: "list", flags: { all: true }, params: {} }, { currency: usd });
  assert.equal(list.length, 1);
  assert.ok(list[0]!.url.endsWith("/campaigns?offset=0&limit=1000"));
  assert.deepEqual(res.response.data, []);
});

test("currencyResolver can't tell the currency from an ACL answer without rows", async () => {
  record(() => ({ data: { orgId: 1 } }));
  await assert.rejects(currencyResolver(api, "5", undefined, "1")(), {
    message: "Couldn't determine the account currency from Apple Search Ads. Pass --currency (e.g. USD).",
  });
});

test("body and selector take JSON values as well as JSON text", async () => {
  const calls = record(() => ({ data: [] }));
  const selector = { conditions: [{ field: "status", operator: "EQUALS", values: ["PAUSED"] }] };
  await runAsaOperation(api, "5", { group: "campaigns", action: "find", flags: { selector }, params: {} }, { currency: usd });
  assert.deepEqual(calls[0]!.body, selector);
  await runAsaOperation(
    api,
    "5",
    { group: "campaigns", action: "update", positional: "8", flags: { body: { name: "Old" } }, params: {} },
    { currency: usd },
  );
  assert.deepEqual(calls[1]!.body, { campaign: { name: "Old" } });
  await runAsaOperation(
    api,
    "5",
    { group: "keywords", action: "create", flags: { campaign: "1", adgroup: "2", body: [{ text: "a" }] }, params: {} },
    { currency: usd },
  );
  assert.deepEqual(calls[2]!.body, [{ text: "a" }]);
  await runAsaOperation(
    api,
    "5",
    { group: "reports", action: "campaigns", flags: { start: "2025-01-01", end: "2025-01-02", selector: { orderBy: [] } }, params: {} },
    { currency: usd },
  );
  assert.deepEqual((calls[3]!.body as { selector: unknown }).selector, { orderBy: [] });
  await assert.rejects(
    runAsaOperation(api, "5", { group: "campaigns", action: "create", flags: { body: [1] }, params: {} }, { currency: usd }),
    /--body must be a JSON object/,
  );
  assert.equal(calls.length, 4);
});
