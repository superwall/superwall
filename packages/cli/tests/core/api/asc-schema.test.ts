import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.SUPERWALL_ASC_INDEX_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/asc-index.json",
);

import { buildAscBody, lookupAscOp, renderAscDocs, validateAscBody } from "@/core/api/asc-schema";

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
