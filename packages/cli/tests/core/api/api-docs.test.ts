import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  deriveApiIndex,
  findOperations,
  loadApiIndex,
  matchesPath,
  renderApiDocs,
  searchOperations,
  type ApiDocsIndex,
} from "@/core/api/api-docs";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => clearHomes());

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
  assert.equal((await loadApiIndex({ fetchIndex })).version, "v1");
  assert.equal((await loadApiIndex({ fetchIndex })).version, "v1");
  assert.equal(fetches, 1);
  assert.equal((await loadApiIndex({ refresh: true, fetchIndex })).version, "v2");
  const offline = async (): Promise<ApiDocsIndex> => {
    throw new Error("offline");
  };
  assert.equal((await loadApiIndex({ refresh: true, fetchIndex: offline })).version, "v2");
});

test("with nothing cached and no network, loading says why", async () => {
  useHome();
  await assert.rejects(
    loadApiIndex({ fetchIndex: async () => Promise.reject(new Error("offline")) }),
    /offline/,
  );
});
