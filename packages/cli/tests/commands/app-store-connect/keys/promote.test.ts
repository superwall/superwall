import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as promote } from "@/commands/app-store-connect/keys/promote";
import { ApiError } from "@/core/api/client";
import { runWithApi as keys } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const IMPORT = "/v2/organizations/9/app-store-connect/applications/8/import";

const answer = (outcome: string, extra: Record<string, unknown> = {}) => ({
  object: "app_store_connect_key_promotion",
  application_id: 8,
  organization_id: 9,
  key_id: "APIKEY0001",
  team_id: "TEAM000001",
  outcome,
  ...extra,
});

const routes = (reply: unknown) => (method: string, path: string) => {
  if (method !== "POST" || path !== IMPORT) return undefined;
  if (reply instanceof Error) throw reply;
  return reply;
};

test("keys promote copies the app's key to the app's organization", async () => {
  const run = await keys(promote, { flags: { app: "8" } }, { routes: routes(answer("saved")) });
  assert.equal(process.exitCode, undefined);
  assert.equal(run.wrote("POST", IMPORT).length, 1);
  assert.deepEqual(run.said("success"), [
    "App Store Connect API key APIKEY0001 from `Acme` is now your organization's for Apple team TEAM000001. The signed proxy uses it.",
  ]);
});

test("keys promote leaves an organization key that already exists", async () => {
  const run = await keys(promote, { flags: { app: "8" } }, { routes: routes(answer("exists")) });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.said("success"), [
    "Your organization already has a key for Apple team TEAM000001. It was left as it is, and the signed proxy uses it.",
  ]);
});

test("keys promote exits 1 with what to do for each outcome that copies nothing", async () => {
  const cases: Array<[string, RegExp]> = [
    ["no_team_id", /Apple didn't say which team key APIKEY0001 belongs to.*asc keys create --help/],
    ["apple_unavailable", /Apple couldn't be reached.*Run it again later\./],
    ["failed", /couldn't be saved to your organization\. Run it again, or add an organization key/],
  ];
  for (const [outcome, message] of cases) {
    process.exitCode = undefined;
    const run = await keys(promote, { flags: { app: "8" } }, { routes: routes(answer(outcome, { team_id: null })) });
    assert.equal(process.exitCode, 1, outcome);
    assert.match(run.said("error")[0] ?? "", message);
  }
});

test("keys promote --json prints the endpoint's answer", async () => {
  const run = await keys(promote, { json: true, flags: { app: "8" } }, { routes: routes(answer("saved")) });
  assert.deepEqual(run.json(), answer("saved"));

  const failed = await keys(promote, { json: true, flags: { app: "8" } }, { routes: routes(answer("failed")) });
  assert.equal(process.exitCode, 1);
  assert.equal((failed.json() as { outcome: string }).outcome, "failed");
});

test("keys promote --dry-run posts nothing", async () => {
  const run = await keys(promote, { flags: { app: "8", dryRun: true } }, { routes: routes(answer("saved")) });
  assert.equal(run.wrote("POST", "/import").length, 0);
  assert.deepEqual(run.said("info"), ["[dry-run] would copy the App Store Connect API key of Acme to your organization"]);

  const json = await keys(promote, { json: true, flags: { app: "8", dryRun: true } }, { routes: routes(answer("saved")) });
  assert.deepEqual(json.json(), { dryRun: true, action: "promote", application_id: "8" });
});

test("keys promote explains a missing key and missing project access", async () => {
  const missing = await keys(promote, { flags: { app: "8" } }, {
    routes: routes(new ApiError(`POST ${IMPORT}`, 404, JSON.stringify({ message: "Not found" }))),
  });
  assert.deepEqual(missing.said("error"), [
    "`Acme` has no saved App Store Connect API key to copy. Save one with `superwall asc keys create --app <app>`.",
  ]);

  const restricted = await keys(promote, { flags: { app: "8" } }, {
    routes: routes(new ApiError(`POST ${IMPORT}`, 403, JSON.stringify({ message: "Forbidden" }))),
  });
  assert.match(restricted.said("error")[0] ?? "", /needs access to every project/);

  const other = await keys(promote, { flags: { app: "8" } }, {
    routes: routes(new ApiError(`POST ${IMPORT}`, 500, JSON.stringify({ message: "Boom" }))),
  });
  assert.match(other.said("error")[0] ?? "", /Boom/);
});
