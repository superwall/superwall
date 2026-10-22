import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  deriveApiIndex,
  findOperations,
  listMatchingOperations,
  resolveApiIndex,
  matchesPath,
  renderApiDocs,
  searchOperations,
  type ApiDocsIndex,
} from "@/core/api/reference";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  clearHomes();
  restoreFetch();
});

const spec = {
  info: { version: "2.0.0" },
  paths: {
    "/v2/campaigns/{id}/audiences/{audience_id}/variants": {
      post: {
        tags: ["Campaigns V2"],
        summary: "Create Variant",
        description:
          "Adds a variant (treatment or holdout) to an audience. Requires campaigns:write scope.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "audience_id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type", "paywall"],
                properties: {
                  type: {
                    anyOf: [
                      { type: "string", enum: ["treatment"] },
                      { type: "string", enum: ["holdout"] },
                    ],
                    description: "Treatment or holdout",
                  },
                  paywall: { anyOf: [{ type: "string" }, { type: "null" }] },
                  percentage: { type: "number" },
                  rules: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["field"],
                      properties: { field: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" }, percentage: { type: "number" } },
                },
              },
            },
          },
          "400": { description: "bad" },
        },
      },
    },
    "/v2/paywalls": {
      get: {
        tags: ["Paywalls V2"],
        summary: "List Paywalls",
        description: "Requires paywalls:read scope.",
        parameters: [
          { name: "application_id", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {},
      },
      post: { tags: ["Paywalls V2"], summary: "Create Paywall", responses: {} },
    },
    "/v2/internal/secret": { get: { summary: "Internal", responses: {} } },
  },
};

const index = (): ApiDocsIndex => deriveApiIndex(spec);

test("the index keeps each endpoint's group, scope, parameters, body and returned fields", () => {
  const ops = index().operations;
  assert.equal(ops.length, 3, "internal endpoints are left out");
  const variant = ops.find((op) => op.summary === "Create Variant")!;
  assert.equal(variant.group, "Campaigns");
  assert.equal(variant.scope, "campaigns:write");
  assert.deepEqual(
    variant.params.map((p) => [p.name, p.in, p.required]),
    [
      ["id", "path", true],
      ["audience_id", "path", true],
    ],
  );
  assert.deepEqual(
    variant.body!.map((f) => [f.name, f.type, f.required]),
    [
      ["type", '"treatment" | "holdout"', true],
      ["paywall", "string | null", true],
      ["percentage", "number", false],
      ["rules", "object[]", false],
    ],
  );
  assert.deepEqual(
    variant.body![3]!.fields!.map((f) => f.name),
    ["field"],
  );
  assert.deepEqual(variant.returns, ["id", "percentage"]);
});

test("a concrete path with ids finds its template, and a method narrows it", () => {
  assert.ok(
    matchesPath(
      "/v2/campaigns/{id}/audiences/{audience_id}/variants",
      "/v2/campaigns/12/audiences/3/variants",
    ),
  );
  assert.ok(!matchesPath("/v2/paywalls", "/v2/paywalls/1"));
  assert.equal(findOperations(index(), "/v2/paywalls?application_id=1").length, 2);
  assert.deepEqual(
    findOperations(index(), "/v2/paywalls", "post").map((op) => op.summary),
    ["Create Paywall"],
  );
});

test("search ranks summary hits first and understands words agents use for the same thing", () => {
  assert.deepEqual(
    searchOperations(index(), "paywall").map((op) => op.summary),
    ["List Paywalls", "Create Paywall"],
  );
  assert.deepEqual(
    searchOperations(index(), "experiment").map((op) => op.summary),
    ["Create Variant"],
  );
  assert.deepEqual(
    searchOperations(index(), "a/b test").map((op) => op.summary),
    ["Create Variant"],
  );
  assert.deepEqual(searchOperations(index(), "variant nothing-like-this"), []);
});

test("rendering lists groups, a search's hits, or one endpoint in full", () => {
  assert.match(
    renderApiDocs(index()),
    /Superwall API 2\.0\.0 — 3 endpoints[\s\S]*Campaigns \(1\)[\s\S]*Paywalls \(2\)/,
  );
  assert.match(renderApiDocs(index(), "paywalls"), /2 endpoints match "paywalls"/);
  const one = renderApiDocs(index(), "/v2/campaigns/1/audiences/2/variants", "POST");
  assert.match(one, /needs campaigns:write/);
  assert.match(one, /type: "treatment" \| "holdout"  — Treatment or holdout/);
  assert.match(one, /percentage\?: number/);
  assert.match(one, /\n    field: string/);
  assert.match(one, /Call it: superwall post \/v2\/campaigns/);
  assert.match(renderApiDocs(index(), "post /v2/paywalls"), /^POST \/v2\/paywalls/);
  assert.match(renderApiDocs(index(), "/v2/nope"), /No endpoint matches \/v2\/nope/);
  assert.match(renderApiDocs(index(), "zzz"), /Nothing matches "zzz"/);
});

test("the reference is cached a day, refreshed on demand, and a stale copy answers offline", async () => {
  useHome();
  let fetches = 0;
  const fetchIndex = async () => {
    fetches++;
    return { ...index(), version: `v${fetches}` };
  };
  assert.equal((await resolveApiIndex({ fetchIndex })).version, "v1");
  assert.equal((await resolveApiIndex({ fetchIndex })).version, "v1");
  assert.equal(fetches, 1);
  assert.equal((await resolveApiIndex({ refresh: true, fetchIndex })).version, "v2");
  const offline = async (): Promise<ApiDocsIndex> => {
    throw new Error("offline");
  };
  assert.equal((await resolveApiIndex({ refresh: true, fetchIndex: offline })).version, "v2");
});

test("with nothing cached and no network, loading says why", async () => {
  useHome();
  await assert.rejects(
    resolveApiIndex({ fetchIndex: async () => Promise.reject(new Error("offline")) }),
    /offline/,
  );
});

const edgeSpec = {
  paths: {
    "/v2/things": {
      get: {
        operationId: "listThings",
        parameters: [
          { name: "q", in: "query", description: "  Free\n text  " },
          { name: "kind", in: "query", schema: { const: "a" } },
          { name: "size", in: "query", schema: { enum: [1, 2] } },
          { name: "maybe", in: "query", schema: { type: ["string", "null"] } },
        ],
        responses: { "200": { content: { "application/json": { schema: { anyOf: [{ type: "null" }] } } } } },
      },
      post: {
        requestBody: { content: { "text/plain": {} } },
        responses: {},
      },
      put: {
        summary: "Replace Thing",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  a: { properties: { b: { properties: { c: { properties: { d: { type: "string" } } } } } } },
                  loose: {},
                  either: { oneOf: [{ type: "string" }, { properties: { x: { type: "string" } } }] },
                },
              },
            },
          },
        },
        responses: {},
      },
    },
  },
};

test("the index fills in defaults and describes loosely typed schemas", () => {
  const derived = deriveApiIndex(edgeSpec);
  assert.equal(derived.version, "?");
  const [list, create, replace] = derived.operations;
  assert.equal(list?.summary, "listThings");
  assert.equal(list?.group, "Other");
  assert.deepEqual(list?.params, [
    { name: "q", in: "query", type: "any", required: false, description: "Free text" },
    { name: "kind", in: "query", type: '"a"', required: false },
    { name: "size", in: "query", type: "1 | 2", required: false },
    { name: "maybe", in: "query", type: "string | null", required: false },
  ]);
  assert.deepEqual(list?.returns, []);
  assert.equal(create?.summary, "/v2/things");
  assert.deepEqual(create?.body, []);
  assert.deepEqual(replace?.body, [
    {
      name: "a",
      type: "object",
      required: false,
      fields: [{ name: "b", type: "object", required: false, fields: [{ name: "c", type: "object", required: false }] }],
    },
    { name: "loose", type: "any", required: false },
    { name: "either", type: "string | object", required: false, fields: [{ name: "x", type: "string", required: false }] },
  ]);
  assert.deepEqual(deriveApiIndex({}).operations, []);
});

test("one search hit shows the endpoint in full, and an empty body says so", () => {
  const derived = deriveApiIndex(edgeSpec);
  assert.equal(
    renderApiDocs(derived, "listThings"),
    [
      "GET /v2/things",
      "listThings · Other",
      "",
      "Query:",
      "  q?: any  — Free text",
      '  kind?: "a"',
      "  size?: 1 | 2",
      "  maybe?: string | null",
      "",
      "Call it: superwall get /v2/things",
    ].join("\n"),
  );
  assert.match(renderApiDocs(derived, "/v2/things", "post"), /\nBody \(JSON\):\n {2}\(empty\)\n\nCall it: superwall post \/v2\/things$/);
  assert.match(renderApiDocs(index(), "/v2/paywalls", "get"), /\n\nRequires paywalls:read scope\.\n\nQuery:\n {2}application_id: string\n/);
});

test("a long search shows forty hits and counts the rest", () => {
  const many = {
    paths: Object.fromEntries(
      Array.from({ length: 45 }, (_, i) => [`/v2/widgets/${String(i).padStart(2, "0")}`, { get: { summary: `Widget ${i}`, responses: {} } }]),
    ),
  };
  const out = renderApiDocs(deriveApiIndex(many), "widget");
  const lines = out.split("\n");
  assert.equal(lines[0], '45 endpoints match "widget":');
  assert.equal(lines.filter((entry) => entry.startsWith("GET ")).length, 40);
  assert.ok(lines.includes("… 5 more — add a word to narrow it"));
});

test("listMatchingOperations answers a path, words, or everything", () => {
  const all = index();
  assert.deepEqual(listMatchingOperations(all, "/v2/paywalls", "post").map((op) => op.summary), ["Create Paywall"]);
  assert.deepEqual(listMatchingOperations(all, "experiment", undefined).map((op) => op.summary), ["Create Variant"]);
  assert.equal(listMatchingOperations(all, "", undefined), all.operations);
});

test("the reference downloads from the API host and says when it can't", async () => {
  useHome();
  const host = process.env.SUPERWALL_API_HOST;
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  try {
    const log = useFetch([{ match: "/openapi.json", body: spec }]);
    const fresh = await resolveApiIndex();
    assert.deepEqual(log.map((entry) => entry.url), ["https://api.example.com/openapi.json"]);
    assert.equal(fresh.version, "2.0.0");
    useFetch([{ match: "/openapi.json", status: 503 }]);
    assert.equal((await resolveApiIndex({ refresh: true })).version, "2.0.0");
  } finally {
    if (host === undefined) delete process.env.SUPERWALL_API_HOST;
    else process.env.SUPERWALL_API_HOST = host;
  }
  useHome();
  useFetch([{ match: "/openapi.json", status: 503 }]);
  await assert.rejects(resolveApiIndex(), { message: "Couldn't fetch the Superwall API reference (HTTP 503)." });
});
