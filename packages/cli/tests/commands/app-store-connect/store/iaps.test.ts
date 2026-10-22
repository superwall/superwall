import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc iaps list reads the V2 in-app purchases", async () => {
  const { api } = ascRoutes({ "GET /v1/apps/555/inAppPurchasesV2?limit=200": page([one("inAppPurchases", "701", { productId: "coins.100" })]) });
  const result = await runLine("asc iaps list 555 --json", { api });
  assert.deepEqual(result.json, [{ id: "701", productId: "coins.100" }]);
});

test("asc iaps create --help names Apple's purchase types", async () => {
  assert.match(await helpLine("asc iaps create --help"), /CONSUMABLE, NON_CONSUMABLE/);
});
