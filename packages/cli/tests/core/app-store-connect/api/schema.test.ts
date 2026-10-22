import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

process.env.SW_ASC_REFRESH = "1";

import { buildAscBody, lookupAscOp, renderAscDocs, validateAscBody } from "@/core/app-store-connect/api/schema";
import { type AscIndex, type AscOperation, readCachedIndex, writeCachedIndex } from "@/core/app-store-connect/api/spec";
import { command as docs } from "@/commands/app-store-connect/api/docs";
import { ASC_FIXTURE, buildZip, serveZip, useAscIndex } from "../../../helpers/asc-spec";
import { runCommand } from "../../../helpers/command";
import { restoreFetch } from "../../../helpers/fetch";

useAscIndex();

test("lookupAscOp matches a concrete id against a templated path", () => {
  const found = lookupAscOp("patch", "/v1/subscriptions/ABC123");
  assert.ok(found, "expected /v1/subscriptions/{id} PATCH to resolve");
  assert.equal(found.path, "/v1/subscriptions/{id}");
});

test("buildAscBody assembles a JSON:API envelope from flat params", () => {
  const found = lookupAscOp("post", "/v1/subscriptions");
  assert.ok(found);
  const body = buildAscBody(found.op, "post", "/v1/subscriptions", {
    name: "Pro",
    productId: "com.x.pro",
    familySharable: "true",
    groupLevel: "1",
    group: "GRP1",
  });
  assert.deepEqual(body, {
    data: {
      type: "subscriptions",
      attributes: {
        name: "Pro",
        productId: "com.x.pro",
        familySharable: true, // cast from string by declared type
        groupLevel: 1,
      },
      relationships: {
        group: { data: { type: "subscriptionGroups", id: "GRP1" } },
      },
    },
  });
});

test("buildAscBody passes through an already-enveloped body", () => {
  const found = lookupAscOp("post", "/v1/subscriptions");
  assert.ok(found);
  const raw = { data: { type: "subscriptions", attributes: { name: "Pro" } } };
  assert.deepEqual(buildAscBody(found.op, "post", "/v1/subscriptions", raw), raw);
});

test("buildAscBody fills data.id from the path on PATCH", () => {
  const found = lookupAscOp("patch", "/v1/subscriptions/ABC123");
  assert.ok(found);
  const body = buildAscBody(found.op, "patch", "/v1/subscriptions/ABC123", {
    name: "Renamed",
  }) as { data: { id?: string } };
  assert.equal(body.data.id, "ABC123");
});

test("validateAscBody flags missing required fields and bad enums", () => {
  const found = lookupAscOp("post", "/v1/subscriptions");
  assert.ok(found);
  const body = buildAscBody(found.op, "post", "/v1/subscriptions", {
    name: "Pro",
    subscriptionPeriod: "MONTHLY", // not a valid enum value
  });
  const problems = validateAscBody(found.op, "post", body);
  assert.ok(problems.some((p) => p.includes("productId")));
  assert.ok(problems.some((p) => p.includes("group")));
  assert.ok(problems.some((p) => p.includes("subscriptionPeriod")));
});

test("validateAscBody passes a complete body", () => {
  const found = lookupAscOp("post", "/v1/subscriptions");
  assert.ok(found);
  const body = buildAscBody(found.op, "post", "/v1/subscriptions", {
    name: "Pro",
    productId: "com.x.pro",
    group: "GRP1",
  });
  assert.deepEqual(validateAscBody(found.op, "post", body), []);
});

test("renderAscDocs renders a path schema and tokenized search", () => {
  const schema = renderAscDocs("/v1/subscriptions", "post");
  assert.match(schema, /data\.type: subscriptions/);
  assert.match(schema, /group → subscriptionGroups/);

  const search = renderAscDocs("introductory offer");
  assert.match(search, /subscriptionIntroductoryOffers/);
});

afterEach(() => {
  restoreFetch();
  mock.restoreAll();
  process.exitCode = undefined;
});

const OP: AscOperation = {
  dataType: "things",
  attributes: {
    name: { required: true, type: "string" },
    enabled: { required: false, type: "boolean" },
    count: { required: false, type: "integer" },
    price: { required: false, type: "number" },
    tier: { required: true, enum: ["LOW", "HIGH"] },
    blob: { required: true },
  },
  relationships: {
    owner: { required: true, many: false, target: "owners" },
    tags: { required: false, many: true, target: "tags" },
    parent: { required: true },
  },
};

test("lookupAscOp ignores the query string, accepts a placeholder, and misses unknown paths", () => {
  assert.equal(lookupAscOp("GET", "/v1/subscriptions/{id}?include=group")?.path, "/v1/subscriptions/{id}");
  assert.equal(lookupAscOp("get", "/v1/nothingHere"), undefined);
  assert.equal(lookupAscOp("put", "/v1/subscriptions/ABC"), undefined);
});

test("buildAscBody leaves a body alone when the operation takes no typed data", () => {
  const found = lookupAscOp("post", "/v1/appCustomProductPageLocalizations/L1/relationships/searchKeywords");
  assert.ok(found);
  const flat = { data: "raw" };
  assert.equal(buildAscBody(found.op, "post", "/v1/x", flat), flat);
});

test("buildAscBody casts by declared type and keeps what it can't cast", () => {
  assert.deepEqual(
    buildAscBody(OP, "post", "/v1/things", {
      enabled: "false",
      count: "12",
      price: "abc",
      blob: " ",
      tier: 3,
      extra: "kept",
      tags: ["a", 2],
      owner: 7,
    }),
    {
      data: {
        type: "things",
        attributes: { enabled: false, count: 12, price: "abc", blob: " ", tier: 3, extra: "kept" },
        relationships: {
          tags: { data: [{ type: "tags", id: "a" }, { type: "tags", id: "2" }] },
          owner: { data: { type: "owners", id: "7" } },
        },
      },
    },
  );
  assert.deepEqual(buildAscBody(OP, "post", "/v1/things", { enabled: "yes", count: "  ", tags: "solo" }), {
    data: {
      type: "things",
      attributes: { enabled: "yes", count: "  " },
      relationships: { tags: { data: [{ type: "tags", id: "solo" }] } },
    },
  });
});

test("buildAscBody on PATCH takes no id from a templated path and sends a bare envelope when empty", () => {
  assert.deepEqual(buildAscBody(OP, "PATCH", "/v1/things/{id}", {}), { data: { type: "things" } });
});

test("validateAscBody names every missing field, and lets PATCH and non-string values through", () => {
  assert.deepEqual(validateAscBody(OP, "post", {}), [
    "missing required attribute: name",
    "missing required attribute: tier",
    "missing required attribute: blob",
    "missing required relationship: owner → owners",
    "missing required relationship: parent",
  ]);
  assert.deepEqual(validateAscBody(OP, "patch", { data: { attributes: { tier: "MID" } } }), [
    'tier "MID" not allowed — use LOW|HIGH',
  ]);
  assert.deepEqual(validateAscBody(OP, "patch", { data: { attributes: { tier: 1 }, relationships: [] } }), []);
  assert.deepEqual(validateAscBody({}, "post", { data: "x" }), []);
});

test("renderAscDocs lists top-level resources for an empty query", () => {
  const roots = renderAscDocs("  ");
  assert.match(roots, /^App Store Connect API — spec 4\.4\n\n169 top-level resources\. /);
  assert.match(roots, /\n\/v1\/accessibilityDeclarations\n\/v1\/actors\n/);
});

test("renderAscDocs shows every verb of a path, query parameters, and a miss", () => {
  const all = renderAscDocs("/v1/subscriptions/S1");
  assert.deepEqual(all.match(/^### \w+ .*$/gm), [
    "### GET /v1/subscriptions/{id}",
    "### PATCH /v1/subscriptions/{id}",
    "### DELETE /v1/subscriptions/{id}",
  ]);
  assert.match(renderAscDocs("/v1/appCustomProductPageLocalizations/L1/relationships/searchKeywords", "GET"), /Query: `limit`/);
  assert.equal(
    renderAscDocs("/v1/nowhere"),
    "App Store Connect API — spec 4.4\n\nNo operation matches /v1/nowhere. Try `asc docs <search term>`.",
  );
});

test("renderAscDocs search caps long result lists and says when nothing matches", () => {
  const many = renderAscDocs("v1");
  assert.equal(many.split("\n").filter((line) => /^(GET|POST|PATCH|DELETE) /.test(line)).length, 60);
  assert.match(many, /\n… \d+ more\n\nRun `asc docs <path> \[verb\]` for a full schema\.$/);
  assert.equal(renderAscDocs("zzzz qqqq"), 'App Store Connect API — spec 4.4\n\nNothing matches "zzzz qqqq".');
});

function captureStdout(): () => string {
  let out = "";
  mock.method(process.stdout, "write", (chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  return () => {
    mock.restoreAll();
    return out;
  };
}

test("asc docs prints the markdown for a person", async () => {
  const stop = captureStdout();
  await runCommand(docs, { api: {}, args: { query: ["/v1/subscriptions", "post"] } });
  const out = stop();
  assert.match(out, /^App Store Connect API — spec 4\.4\n\n### POST \/v1\/subscriptions\n/);
  assert.match(out, /Example:\n  superwall asc post \/v1\/subscriptions -d name=<string> -d productId=<string> -d group=<subscriptionGroups id>\n$/);
});

const FIXTURE_INDEX = ASC_FIXTURE;

const CUSTOM: AscIndex = {
  specVersion: "9.9",
  openapi: "3.1.0",
  paths: {
    "/v9/things": {
      post: { ...OP, opId: "things_create", summary: "Create a thing", deprecated: true, query: ["include", "limit"] },
    },
    "/v9/others": { get: { opId: "others_list" } },
  },
};

function useIndex(index: AscIndex): void {
  writeCachedIndex(index);
}

test("renderAscDocs draws summaries, deprecation, enums, untyped fields and untargeted relationships", () => {
  useIndex(CUSTOM);
  assert.equal(
    renderAscDocs("/v9/things"),
    [
      "App Store Connect API — spec 9.9",
      "",
      "### POST /v9/things",
      "Create a thing",
      "> ⚠ Deprecated in the App Store Connect API.",
      "",
      "Body → `data.type: things`",
      "",
      "Attributes:",
      "  - name  string  (required)",
      "  - enabled  boolean",
      "  - count  integer",
      "  - price  number",
      "  - tier  LOW|HIGH  (required)",
      "  - blob    (required)",
      "",
      "Relationships:",
      "  - owner → owners  (required)",
      "  - tags → tags[]",
      "  - parent → ?  (required)",
      "",
      "Query: `include`, `limit`",
      "",
      "Example:",
      "  superwall asc post /v9/things -d name=<string> -d tier=LOW -d blob=<value> -d owner=<owners id> -d parent=<id id>",
    ].join("\n"),
  );
  assert.equal(
    renderAscDocs("thing create"),
    "App Store Connect API — spec 9.9\n\nPOST   /v9/things  — Create a thing\n\nRun `asc docs <path> [verb]` for a full schema.",
  );
  assert.match(renderAscDocs("others"), /\nGET    \/v9\/others\n/);
});

test("asc docs --refresh downloads the schema and says which spec it got", async () => {
  useIndex(CUSTOM);
  const zip = buildZip([{ name: "spec.json", data: Buffer.from(JSON.stringify({ openapi: "3.0", info: { version: "5.0" }, paths: {} })) }]);
  serveZip(zip);
  const stop = captureStdout();
  await runCommand(docs, { api: {}, flags: { refresh: true } });
  assert.equal(stop(), "App Store Connect schema updated — spec 5.0\n");
  assert.equal(readCachedIndex().specVersion, "5.0");

  serveZip(zip);
  const asJson = await runCommand(docs, { api: {}, flags: { refresh: true }, json: true });
  assert.deepEqual(asJson.json, { specVersion: "5.0" });

  serveZip(zip);
  const withQuery = await runCommand(docs, { api: {}, args: { query: ["/v1/apps"] }, flags: { refresh: true }, json: true });
  assert.match((withQuery.json as { markdown: string }).markdown, /spec 5\.0\n\nNo operation matches \/v1\/apps\./);
});

test("asc docs --refresh --quiet downloads silently, and still answers a query", async () => {
  useIndex(CUSTOM);
  const zip = buildZip([{ name: "spec.json", data: Buffer.from(JSON.stringify({ info: { version: "6.0" }, paths: {} })) }]);
  serveZip(zip);
  const stop = captureStdout();
  const silent = await runCommand(docs, { api: {}, flags: { refresh: true, quiet: true } });
  assert.equal(stop(), "");
  assert.deepEqual(silent.calls.map((call) => call.method).filter((method) => method !== "start" && method !== "stop"), []);

  serveZip(zip);
  const answered = await runCommand(docs, { api: {}, args: { query: ["thing"] }, flags: { refresh: true, quiet: true }, json: true });
  assert.match((answered.json as { markdown: string }).markdown, /^App Store Connect API — spec 6\.0\n\nNothing matches "thing"\.$/);
  useIndex(FIXTURE_INDEX);
});
