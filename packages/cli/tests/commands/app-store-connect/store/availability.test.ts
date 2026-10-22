import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc availability get reads where an in-app purchase is sold", async () => {
  const { api } = ascRoutes({
    "GET /v2/inAppPurchases/701/inAppPurchaseAvailability": { data: one("inAppPurchaseAvailabilities", "IA1", { availableInNewTerritories: false }) },
    "GET /v1/inAppPurchaseAvailabilities/IA1/availableTerritories?limit=200": page([one("territories", "USA")]),
  });
  const result = await runLine("asc availability get --iap 701 --json", { api });
  assert.deepEqual(result.json, { id: "IA1", availableInNewTerritories: false, territories: ["USA"] });
  assert.match(await helpLine("asc availability set --help"), /--available-in-new-territories/);
});
