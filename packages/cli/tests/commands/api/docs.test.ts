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
