import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("GET", "/v2/paywalls/{id}/versions", {
      params: [{ name: "starting_after", in: "query", type: "string", required: false }],
    }),
    op("POST", "/v2/paywalls/{id}/duplicate", {
      body: [{ name: "name", type: "string", required: false, description: "Name of the copy" }],
    }),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("paywalls list reads the app's paywalls", async () => {
  const calls: ApiCall[] = [];
  const rows = [{ id: "w1", name: "Pro" }];
  const api = fakeResourceApi(calls, { "LIST /v2/paywalls?application_id=5861": rows });

  const result = await runLine("paywalls list --app 5861 --json", { api });

  assert.deepEqual(calls, [{ method: "LIST", path: "/v2/paywalls?application_id=5861" }]);
  assert.deepEqual(result.json, rows);
});

test("a paged list operation walks every page through the API's lister", async () => {
  const calls: ApiCall[] = [];
  const versions = [{ id: "v2", version: 2 }, { id: "v1", version: 1 }];
  const api = fakeResourceApi(calls, { "LIST /v2/paywalls/208540/versions": versions });

  const result = await runLine("paywalls versions 208540 --json", { api });

  assert.deepEqual(calls, [{ method: "LIST", path: "/v2/paywalls/208540/versions" }]);
  assert.deepEqual(result.json, versions);
});

test("duplicating a paywall sends its typed body and reports it done", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "POST /v2/paywalls/208540/duplicate": { id: 208541, name: "Pro copy" } });

  const result = await runLine("paywalls duplicate 208540 --name Pro-copy", { api });

  assert.deepEqual(calls, [{ method: "POST", path: "/v2/paywalls/208540/duplicate", body: { name: "Pro-copy" } }]);
  assert.deepEqual(result.said("success"), ["Copy a paywall — done"]);
  assert.match(result.said("report").join(), /name +Pro copy/);
});

test("archiving a paywall needs --yes outside a terminal; unarchiving does not", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls);

  const refused = await runLine("paywalls archive 208540 --json", { api });
  assert.match((refused.json as { error: { message: string } }).error.message, /Pass --yes to go ahead/);
  await runLine("paywalls unarchive 208540 --json", { api });

  assert.deepEqual(calls, [{ method: "POST", path: "/v2/paywalls/208540/unarchive", body: {} }]);
});

test("paywalls --help lists its operations, and get --help names its argument", async () => {
  const help = await helpLine("paywalls --help");
  assert.match(help, /Paywalls in the dashboard/);
  assert.match(help, /versions +<paywall> +Versions pushed from code/);

  const get = await helpLine("paywalls get --help");
  assert.match(get, /<paywall> +The paywall's id/);
  assert.match(get, /Flags come from the API reference, which couldn't be loaded/);
});
