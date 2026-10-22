import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as availability } from "@/commands/app-store-connect/store/availability";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { iapView, subscriptionView } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const territories = (...ids: string[]) => ({ data: ids.map((id) => ({ type: "territories", id })) });

test("set on a subscription patches its existing plan availability", async () => {
  const { api, writes } = ascRoutes({ ...subscriptionView("601"), "PATCH /v1/subscriptionPlanAvailabilities/A1": { data: one("subscriptionPlanAvailabilities", "A1") } });
  const result = await runCommand(availability, { api, words: ["set"], flags: { subscription: "601", availableTerritories: "usa, mex", availableInNewTerritories: true } });
  assert.deepEqual(writes(), [
    {
      method: "PATCH",
      path: "/v1/subscriptionPlanAvailabilities/A1",
      body: {
        data: {
          type: "subscriptionPlanAvailabilities",
          id: "A1",
          attributes: { availableInNewTerritories: true },
          relationships: { availableTerritories: territories("USA", "MEX") },
        },
      },
    },
  ]);
  assert.deepEqual(result.said("success"), ["Available in 2 territories"]);
});

test("set on a subscription with none yet, or on an in-app purchase, posts a new availability", async () => {
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/602/planAvailabilities?limit=50": page([]),
    "POST /v1/subscriptionPlanAvailabilities": { data: one("subscriptionPlanAvailabilities", "A2") },
    "GET /v1/territories?limit=200&fields[territories]=currency": page([one("territories", "USA")]),
    "POST /v1/inAppPurchaseAvailabilities": { data: one("inAppPurchaseAvailabilities", "IA1") },
    ...iapView("701"),
  });
  await runCommand(availability, { api, words: ["set"], flags: { subscription: "602", availableTerritories: "USA", dryRun: true } });
  assert.deepEqual(writes(), []);
  const iap = await runCommand(availability, { api, words: ["set"], flags: { iap: "701", availableTerritories: "all" }, json: true });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/inAppPurchaseAvailabilities",
      body: {
        data: {
          type: "inAppPurchaseAvailabilities",
          attributes: { availableInNewTerritories: true },
          relationships: { inAppPurchase: link("inAppPurchases", "701"), availableTerritories: territories("USA") },
        },
      },
    },
  ]);
  assert.deepEqual(iap.json, { id: "IA1", availableInNewTerritories: true, territories: ["USA"] });
});

test("get shows where it's sold, or that it isn't yet", async () => {
  const { api } = ascRoutes({ ...subscriptionView("601"), "GET /v2/inAppPurchases/709/inAppPurchaseAvailability": { data: null } });
  const sold = await runCommand(availability, { api, words: ["get"], flags: { subscription: "601" }, json: true });
  assert.deepEqual(sold.json, { id: "A1", planType: "UPFRONT", availableInNewTerritories: false, territories: ["USA", "CAN"] });
  const unsold = await runCommand(availability, { api, words: ["get"], flags: { iap: "709" } });
  assert.deepEqual(unsold.said("success"), ["The in-app purchase 709 isn't available in any territory yet"]);
});
