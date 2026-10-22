import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("POST", "/v2/entitlements/{id}/grants", {
      body: [
        { name: "app_user_id", type: "string", required: true, description: "Who gets it" },
        { name: "expires_at", type: "string | null", required: false },
      ],
    }),
    op("DELETE", "/v2/entitlements/{id}/grants/{grant_id}"),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("entitlements list reads the app's project and returns its rows", async () => {
  const calls: ApiCall[] = [];
  const rows = [{ id: "e1", identifier: "pro" }];
  const api = fakeResourceApi(calls, { "LIST /v2/entitlements?project_id=282": rows });

  const result = await runLine("entitlements --app 5861 --json", { api });

  assert.deepEqual(calls, [{ method: "LIST", path: "/v2/entitlements?project_id=282" }]);
  assert.deepEqual(result.json, rows);
});

test("a grant is created on the entitlement named by the positional, with typed flags", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "POST /v2/entitlements/7/grants": { id: "g1", app_user_id: "user_1" } });

  const result = await runLine("entitlements grants create 7 --app-user-id user_1 --json", { api });

  assert.deepEqual(calls, [{ method: "POST", path: "/v2/entitlements/7/grants", body: { app_user_id: "user_1" } }]);
  assert.deepEqual(result.json, { id: "g1", app_user_id: "user_1" });
});

test("taking a grant back needs --yes outside a terminal", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls);

  const refused = await runLine("entitlements grants delete 7 g1 --json", { api });
  assert.match((refused.json as { error: { message: string } }).error.message, /Take a grant back: DELETE \/v2\/entitlements\/7\/grants\/g1/);
  assert.deepEqual(calls, []);

  await runLine("entitlements grants delete 7 g1 -y --json", { api });
  assert.deepEqual(calls, [{ method: "DELETE", path: "/v2/entitlements/7/grants/g1" }]);
});

test("a grant flag the endpoint doesn't take is refused before anything is sent", async () => {
  const calls: ApiCall[] = [];

  const result = await runLine("entitlements grants create 7 --app-user-id u --level gold --json", { api: fakeResourceApi(calls) });

  assert.match(
    (result.json as { error: { message: string } }).error.message,
    /superwall entitlements grants create has no --level/,
  );
  assert.deepEqual(calls, []);
});

test("entitlements --help shows its grants, and grants create its required body field", async () => {
  const help = await helpLine("entitlements --help");
  assert.match(help, /What a purchase unlocks/);
  assert.match(help, /entitlements grants/);
  assert.match(help, /create +--identifier <identifier> +Create an entitlement/);

  const grant = await helpLine("entitlements grants create --help");
  assert.match(grant, /--app-user-id <string> +required Who gets it/);
  assert.match(grant, /--expires-at <string>/);
});
