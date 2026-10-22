import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc prices points finds the price point at a price", async () => {
  const { api } = ascRoutes({
    "GET /v2/inAppPurchases/701/pricePoints?filter[territory]=USA&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds": page([
      one("inAppPurchasePricePoints", "IP1", { customerPrice: "0.99", proceeds: "0.84" }),
    ]),
  });
  const result = await runLine("asc prices points --iap 701 --price 0.99 --json", { api });
  assert.deepEqual(result.json, [{ id: "IP1", customerPrice: "0.99", proceeds: "0.84" }]);
});

test("asc prices set --help explains equalization", async () => {
  assert.match(await helpLine("asc prices --help"), /equalized price/);
});
