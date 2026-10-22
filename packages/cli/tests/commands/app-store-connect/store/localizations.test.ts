import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc localizations list --iap reads its latest version's localizations", async () => {
  const { api } = ascRoutes({
    "GET /v2/inAppPurchases/701/versions": page([one("inAppPurchaseVersions", "IV1", { version: 1 })]),
    "GET /v1/inAppPurchaseVersions/IV1/localizations?limit=200": page([one("inAppPurchaseLocalizations", "IL1", { locale: "en-US", name: "Coins" })]),
  });
  const result = await runLine("asc localizations list --iap 701 --json", { api });
  assert.deepEqual(result.json, [{ id: "IL1", locale: "en-US", name: "Coins" }]);
});

test("asc localizations add --help marks its required flags", async () => {
  const help = await helpLine("asc localizations add --help");
  assert.match(help, /--locale <locale>\s+required/);
});
