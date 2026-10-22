import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as products } from "@/commands/app-store-connect/store/products";
import { STORE, fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = undefined;
});

const CATALOG = {
  ...STORE,
  "GET /v1/apps/555/inAppPurchasesV2?limit=200": {
    data: [
      { id: "I1", attributes: { productId: "coins.100", inAppPurchaseType: "CONSUMABLE" } },
      { id: "I2", attributes: { productId: "season.pass", inAppPurchaseType: "NON_RENEWING_SUBSCRIPTION" } },
    ],
  },
};

test("products lists subscriptions before in-app purchases, each with its kind", async () => {
  const { api } = fakeAscApi(CATALOG);
  const result = await runCommand(products, { api, args: { id: "555" } });
  assert.deepEqual(result.said("step"), ["3 products"]);
  assert.deepEqual(result.said("info"), ["`pro.monthly`  Subscription  ONE_MONTH", "`coins.100`  Consumable", "`season.pass`  Non-Renewing"]);
});

test("one product is counted in the singular", async () => {
  const { api } = fakeAscApi({ ...CATALOG, "GET /v1/apps/555/inAppPurchasesV2?limit=200": {} });
  const human = await runCommand(products, { api, args: { id: "com.acme.app" } });
  assert.deepEqual(human.said("step"), ["1 product"]);
});
