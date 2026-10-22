import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("GET", "/v3/users/{app_user_id}/subscriptions", {
      params: [{ name: "application_id", in: "query", type: "string", required: true }],
    }),
    op("POST", "/v3/users/{app_user_id}/attributes", {
      params: [{ name: "application_id", in: "query", type: "string", required: true }],
      body: [{ name: "attributes", type: "object", required: true, description: "Attributes to set" }],
    }),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("a user's subscriptions are read for the app the command is about", async () => {
  const calls: ApiCall[] = [];
  const subscriptions = { data: [{ id: "s1", status: "active" }] };
  const api = fakeResourceApi(calls, { "GET /v3/users/user_1/subscriptions?application_id=5861": subscriptions });

  const result = await runLine("users subscriptions user_1 --app 5861 --json", { api });

  assert.deepEqual(calls, [{ method: "GET", path: "/v3/users/user_1/subscriptions?application_id=5861" }]);
  assert.deepEqual(result.json, subscriptions);
});

test("an app user id is escaped into the path", async () => {
  const calls: ApiCall[] = [];

  await runLine("users aliases a/b --json", { api: fakeResourceApi(calls) });

  assert.deepEqual(calls, [{ method: "GET", path: "/v3/users/a%2Fb/aliases" }]);
});

test("setting attributes posts them as a JSON body for the app", async () => {
  const calls: ApiCall[] = [];

  await runLine('users update user_1 --app 5861 --attributes {"plan":"pro"} --json', { api: fakeResourceApi(calls) });

  assert.deepEqual(calls, [
    {
      method: "POST",
      path: "/v3/users/user_1/attributes?application_id=5861",
      body: { attributes: { plan: "pro" } },
    },
  ]);
});

test("a user operation without the user says its usage", async () => {
  const calls: ApiCall[] = [];

  const result = await runLine("users entitlements --json", { api: fakeResourceApi(calls) });

  assert.match((result.json as { error: { message: string } }).error.message, /Usage: superwall users entitlements <user>/);
  assert.deepEqual(calls, []);
});

test("users --help names the user argument, and update --help its body", async () => {
  const help = await helpLine("users --help");
  assert.match(help, /Your app's users: subscriptions, entitlements, attributes/);
  assert.match(help, /events +<user> +What they did, newest first/);

  const update = await helpLine("users update --help");
  assert.match(update, /<user> +The user's app user ID/);
  assert.match(update, /--attributes <object> +required Attributes to set/);
});
