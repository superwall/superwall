import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { referenceHint } from "@/commands/platform/api";
import { runApiDocs } from "@/commands/platform/api-docs";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { run } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  process.exitCode = 0;
});

const spec = {
  info: { version: "2.0.0" },
  paths: {
    "/v2/campaigns/{id}/audiences/{audience_id}/variants": {
      post: { tags: ["Campaigns V2"], summary: "Create Variant", responses: {} },
    },
    "/v2/paywalls": {
      get: { tags: ["Paywalls V2"], summary: "List Paywalls", responses: {} },
      post: { tags: ["Paywalls V2"], summary: "Create Paywall", responses: {} },
    },
  },
};

test("api docs --json returns the matching endpoints, without needing a login", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", body: spec }]);
  const result = await run(runApiDocs.definition, {
    argv: { action: "docs", query: ["variant"], json: true },
  });
  const json = result.json as { version: string; operations: { summary: string }[] };
  assert.equal(json.version, "2.0.0");
  assert.deepEqual(
    json.operations.map((op) => op.summary),
    ["Create Variant"],
  );
});

test("api docs takes a method anywhere among the words", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", body: spec }]);
  const result = await run(runApiDocs.definition, {
    argv: { action: "docs", query: ["post", "/v2/paywalls"], json: true },
  });
  assert.deepEqual(
    (result.json as { operations: { summary: string }[] }).operations.map((op) => op.summary),
    ["Create Paywall"],
  );
});

test("a raw request that fails points at the endpoint, the right method, or a search", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", body: spec }]);
  assert.equal(
    await referenceHint("post", "/v2/campaigns/7/audiences/3/variants"),
    "Its parameters and body: superwall api docs /v2/campaigns/{id}/audiences/{audience_id}/variants post",
  );
  assert.equal(
    await referenceHint("delete", "/v2/paywalls"),
    "/v2/paywalls takes GET, POST, not DELETE: superwall api docs /v2/paywalls",
  );
  assert.equal(
    await referenceHint("get", "/v2/campaign/2071"),
    "No endpoint has this path. Search the reference: superwall api docs campaign",
  );
});

test("with the reference unreachable, the hint still says where to look", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", fail: true }]);
  assert.equal(
    await referenceHint("get", "/v2/x"),
    "The API reference: superwall api docs <words>",
  );
});
