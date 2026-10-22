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

test("patch sends -d as the JSON body, typed and nested, and prints the API's answer", async () => {
  useHome();
  const log = useFetch([{ match: "/v2/projects/282", body: { id: "282", name: "Renamed" } }]);

  const result = await runLine("patch /v2/projects/282 -d name=Renamed -d archived:=false -d meta[team]=growth --json", {
    api: api(),
  });

  assert.equal(log.length, 1);
  assert.equal(log[0]?.method, "PATCH");
  assert.equal(log[0]?.url, "https://api.example.com/v2/projects/282");
  assert.deepEqual(JSON.parse(log[0]?.body ?? ""), { name: "Renamed", archived: false, meta: { team: "growth" } });
  assert.deepEqual(result.json, { id: "282", name: "Renamed" });
});

test("a PATCH the API rejects carries the reference entry for that endpoint", async () => {
  useHome();
  useFetch([
    {
      match: "/openapi.json",
      body: {
        info: { version: "2.0.0" },
        paths: { "/v2/projects/{id}": { patch: { tags: ["Projects V2"], summary: "Update Project", responses: {} } } },
      },
    },
    { match: "/v2/projects/282", status: 400, body: { error: { message: "name is too long" } } },
  ]);

  const result = await runLine("patch /v2/projects/282 -d name=x --json", { api: api() });

  const message = (result.json as { error: { message: string } }).error.message;
  assert.match(message, /name is too long/);
  assert.match(message, /Its parameters and body: superwall api docs \/v2\/projects\/\{id\} patch/);
});

test("a server error is left as it is, without a reference hint", async () => {
  useHome();
  useFetch([{ match: "/v2/projects/282", status: 503, body: { error: { message: "Down for maintenance" } } }]);

  const result = await runLine("patch /v2/projects/282 --json", { api: api() });

  const message = (result.json as { error: { message: string } }).error.message;
  assert.match(message, /Down for maintenance/);
  assert.doesNotMatch(message, /api docs/);
});

test("patch refuses a relative path and an unknown flag before any request", async () => {
  useHome();
  const log = useFetch([]);

  const relative = await runLine("patch v2/projects/282 --json", { api: api() });
  assert.match((relative.json as { error: { message: string } }).error.message, /Path must start with "\/"/);
  await assert.rejects(runLine("patch /v2/projects/282 --name x", { api: api() }), /Unknown flag: --name/);
  assert.equal(log.length, 0);
});

test("patch --help shows its argument, -d and an example", async () => {
  const help = await helpLine("patch --help");

  assert.match(help, /Make PATCH requests to the Superwall API/);
  assert.match(help, /<path>/);
  assert.match(help, /patch \/v2\/projects\/<id> -d name=Renamed/);
});
