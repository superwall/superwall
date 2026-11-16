import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as apiDocs } from "@/commands/api/docs";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { runCommand, runLine } from "../../helpers/command";

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
    "/v2/campaigns/{id}/audiences/order": {
      put: {
        tags: ["Campaigns V2"],
        summary: "Reorder Audiences",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { audience_ids: { type: "array", items: { type: "string" } } } } } },
        },
        responses: {},
      },
    },
    "/v2/raw-only": {
      get: { tags: ["Other"], summary: "Raw Only", responses: {} },
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
  const result = await runCommand(apiDocs, { args: { query: ["variant"] }, json: true });
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
  const result = await runCommand(apiDocs, { args: { query: ["post", "/v2/paywalls"] }, json: true });
  assert.deepEqual(
    (result.json as { operations: { summary: string }[] }).operations.map((op) => op.summary),
    ["Create Paywall"],
  );
});

test("api docs prints the reference as text, and --refresh fetches it again through the parser", async () => {
  useHome();
  const log = useFetch([{ match: "/openapi.json", body: spec }]);
  await runLine("api docs paywalls");
  const result = await runLine("api docs paywalls --refresh");
  assert.equal(log.filter((entry) => entry.url.endsWith("/openapi.json")).length, 2);
  const page = result.said("report").join("\n");
  assert.match(page, /List Paywalls/);
  assert.match(page, /Create Paywall/);
  assert.doesNotMatch(page, /Create Variant/);
});

test("api docs names the resource command for an endpoint, with the raw verb after", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", body: spec }]);
  const page = (await runLine("api docs /v2/campaigns/100804/audiences/order put")).said("report").join("\n");
  assert.match(page, /Call it: superwall campaigns audiences reorder <campaign> -d field=value …/);
  assert.match(page, /Or: superwall put \/v2\/campaigns\/\{id\}\/audiences\/order -d field=value …/);
  const raw = (await runLine("api docs /v2/raw-only")).said("report").join("\n");
  assert.match(raw, /Call it: superwall get \/v2\/raw-only/);
  assert.doesNotMatch(raw, /\nOr: /);
});

test("api docs --json gives each endpoint a resource command covers its command", async () => {
  useHome();
  useFetch([{ match: "/openapi.json", body: spec }]);
  const result = await runCommand(apiDocs, { args: { query: ["/v2/campaigns/100804/audiences/order"] }, json: true });
  const [op] = (result.json as { operations: { command?: string }[] }).operations;
  assert.equal(op?.command, "superwall campaigns audiences reorder <campaign>");
  const raw = await runCommand(apiDocs, { args: { query: ["/v2/raw-only"] }, json: true });
  assert.deepEqual((raw.json as { operations: { command?: string }[] }).operations.map((entry) => entry.command), [undefined]);
});
