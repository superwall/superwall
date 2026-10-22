import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc subscription-groups list prints the app's groups", async () => {
  const { api } = ascRoutes({ "GET /v1/apps/555/subscriptionGroups?limit=200": page([one("subscriptionGroups", "201", { referenceName: "Pro" })]) });
  const result = await runLine("asc subscription-groups list 555", { api });
  assert.deepEqual(result.said("info"), ["`Pro`  201"]);
});

test("asc subscription-groups delete without --yes changes nothing", async () => {
  const { api, sent } = ascRoutes({});
  const result = await runLine("asc subscription-groups delete 201 --no-interactive", { api });
  assert.match(result.said("error")[0] ?? "", /Pass --yes to go ahead/);
  assert.deepEqual(sent, []);
  assert.match(await helpLine("asc subscription-groups --help"), /create/);
});
