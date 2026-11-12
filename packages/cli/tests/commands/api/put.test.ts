import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createSuperwallApi } from "@/core/api/client";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { helpLine, runLine } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  process.exitCode = 0;
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

test("put sends -d as the JSON body, typed and nested, and prints the API's answer", async () => {
  useHome();
  const log = useFetch([{ match: "/v2/campaigns/117816/audiences/201889/weights", body: { id: "201889", object: "audience" } }]);

  const result = await runLine(
    `put /v2/campaigns/117816/audiences/201889/weights -d weights:=[{"variant_id":"v1","percentage":100}] -d meta[team]=growth --json`,
    { api: api() },
  );

  assert.equal(log.length, 1);
  assert.equal(log[0]?.method, "PUT");
  assert.equal(log[0]?.url, "https://api.example.com/v2/campaigns/117816/audiences/201889/weights");
  assert.deepEqual(JSON.parse(log[0]?.body ?? ""), {
    weights: [{ variant_id: "v1", percentage: 100 }],
    meta: { team: "growth" },
  });
  assert.deepEqual(result.json, { id: "201889", object: "audience" });
});

test("a PUT the API rejects carries the reference entry for that endpoint", async () => {
  useHome();
  useFetch([
    {
      match: "/openapi.json",
      body: {
        info: { version: "2.0.0" },
        paths: {
          "/v2/campaigns/{id}/audiences/{audience_id}/weights": {
            put: { tags: ["Campaigns"], summary: "Update Audience Weights", responses: {} },
          },
        },
      },
    },
    {
      match: "/v2/campaigns/117816/audiences/201889/weights",
      status: 400,
      body: { error: { message: "Every treatment must be present" } },
    },
  ]);

  const result = await runLine("put /v2/campaigns/117816/audiences/201889/weights -d weights:=[] --json", { api: api() });

  const message = (result.json as { error: { message: string } }).error.message;
  assert.match(message, /Every treatment must be present/);
  assert.match(
    message,
    /Its parameters and body: superwall api docs \/v2\/campaigns\/\{id\}\/audiences\/\{audience_id\}\/weights put/,
  );
});

test("a server error is left as it is, without a reference hint", async () => {
  useHome();
  useFetch([{ match: "/v2/projects/282", status: 503, body: { error: { message: "Down for maintenance" } } }]);

  const result = await runLine("put /v2/projects/282 --json", { api: api() });

  const message = (result.json as { error: { message: string } }).error.message;
  assert.match(message, /Down for maintenance/);
  assert.doesNotMatch(message, /api docs/);
});

test("put refuses a relative path and an unknown flag before any request", async () => {
  useHome();
  const log = useFetch([]);

  const relative = await runLine("put v2/projects/282 --json", { api: api() });
  assert.match((relative.json as { error: { message: string } }).error.message, /Path must start with "\/"/);
  await assert.rejects(runLine("put /v2/projects/282 --name x", { api: api() }), /Unknown flag: --name/);
  assert.equal(log.length, 0);
});

test("put --help shows its argument, -d and an example", async () => {
  const help = await helpLine("put --help");

  assert.match(help, /Make PUT requests to the Superwall API/);
  assert.match(help, /<path>/);
  assert.match(help, /put \/v2\/campaigns\/<id>\/audiences\/<audience_id>\/weights -d/);
});
