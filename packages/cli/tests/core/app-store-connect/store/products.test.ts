import assert from "node:assert/strict";
import { test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { ascTypeDisplay, findAscAppId, listAscApps, listUnimportedAscProducts } from "@/core/app-store-connect/store/products";
import { fakeAscApi, STORE } from "../../../helpers/asc-proxy";

function orgApi(responses: Record<string, unknown> = {}) {
  const { api, requests } = fakeAscApi(responses);
  return { api: (api as SuperwallApi).forOrg("7"), requests };
}

test("findAscAppId looks the app up by bundle id", async () => {
  const { api, requests } = orgApi(STORE);
  assert.equal(await findAscAppId(api, "T1", "com.acme.app"), "555");
  assert.equal(
    requests[0]?.path,
    "/v2/organizations/7/app-store-connect/proxy/T1/v1/apps?filter[bundleId]=com.acme.app&fields[apps]=bundleId&limit=10",
  );
  assert.equal(await findAscAppId(orgApi({ "GET /v1/apps?filter[bundleId]=x&fields[apps]=bundleId&limit=10": {} }).api, "T1", "x"), undefined);
});

test("listAscApps reads each app's name and bundle id", async () => {
  const { api } = orgApi({
    "GET /v1/apps?limit=200&fields[apps]=bundleId,name": {
      data: [
        { id: "1", attributes: { name: "Acme", bundleId: "com.acme" } },
        { id: "2", attributes: { name: 7 } },
        { id: "3" },
      ],
    },
  });
  assert.deepEqual(await listAscApps(api, "T1"), [
    { id: "1", name: "Acme", bundleId: "com.acme" },
    { id: "2", name: undefined, bundleId: undefined },
    { id: "3", name: undefined, bundleId: undefined },
  ]);
  assert.deepEqual(await listAscApps(orgApi({ "GET /v1/apps?limit=200&fields[apps]=bundleId,name": {} }).api, "T1"), []);
});

test("listUnimportedAscProducts collects subscriptions and in-app purchases once each, skipping imported ones", async () => {
  const { api } = orgApi({
    "GET /v1/apps/555/subscriptionGroups?limit=200": {
      data: [{ id: "G1", attributes: { referenceName: "Pro" } }, { id: "G2" }, { id: "G3" }],
    },
    "GET /v1/subscriptionGroups/G1/subscriptions?limit=200": {
      data: [
        { id: "S1", attributes: { productId: "pro.monthly", name: "Monthly", state: "APPROVED", subscriptionPeriod: "ONE_MONTH" } },
        { id: "S2", attributes: { productId: "pro.yearly" } },
        { id: "S3", attributes: { name: "No product id" } },
        { id: "S4", attributes: { productId: "pro.monthly", name: "Duplicate" } },
        { id: "S5", attributes: { productId: "already.imported" } },
      ],
    },
    "GET /v1/subscriptionGroups/G2/subscriptions?limit=200": {
      data: [{ id: "S6", attributes: { productId: "basic.weekly" } }],
    },
    "GET /v1/subscriptionGroups/G3/subscriptions?limit=200": {},
    "GET /v1/apps/555/inAppPurchasesV2?limit=200": {
      data: [
        { id: "I1", attributes: { productId: "coins.100", name: "Coins", inAppPurchaseType: "CONSUMABLE", state: "READY" } },
        { id: "I2", attributes: { productId: "unlock" } },
        { id: "I3", attributes: { productId: "pro.yearly", name: "Clash" } },
        { id: "I4" },
      ],
    },
  });
  assert.deepEqual(await listUnimportedAscProducts(api, "T1", "555", new Set(["already.imported"])), [
    {
      productId: "pro.monthly",
      referenceName: "Monthly",
      type: "AUTO_RENEWABLE_SUBSCRIPTION",
      state: "APPROVED",
      subscriptionPeriod: "ONE_MONTH",
      subscriptionGroupName: "Pro",
    },
    {
      productId: "pro.yearly",
      referenceName: "Pro",
      type: "AUTO_RENEWABLE_SUBSCRIPTION",
      state: "UNKNOWN",
      subscriptionPeriod: undefined,
      subscriptionGroupName: "Pro",
    },
    {
      productId: "basic.weekly",
      referenceName: "",
      type: "AUTO_RENEWABLE_SUBSCRIPTION",
      state: "UNKNOWN",
      subscriptionPeriod: undefined,
      subscriptionGroupName: "",
    },
    { productId: "coins.100", referenceName: "Coins", type: "CONSUMABLE", state: "READY" },
    { productId: "unlock", referenceName: "", type: "UNKNOWN", state: "UNKNOWN" },
  ]);
});

test("listUnimportedAscProducts copes with an app that has no groups or purchases", async () => {
  const { api, requests } = orgApi({
    "GET /v1/apps/9/subscriptionGroups?limit=200": {},
    "GET /v1/apps/9/inAppPurchasesV2?limit=200": {},
  });
  assert.deepEqual(await listUnimportedAscProducts(api, "T1", "9", new Set()), []);
  assert.equal(requests.length, 2);
});

test("ascTypeDisplay names Apple's product types", () => {
  assert.deepEqual(
    [
      "AUTO_RENEWABLE_SUBSCRIPTION",
      "AUTOMATICALLY_RENEWABLE_SUBSCRIPTION",
      "NON_CONSUMABLE",
      "CONSUMABLE",
      "NON_RENEWING_SUBSCRIPTION",
      "SOMETHING_NEW",
    ].map(ascTypeDisplay),
    ["Subscription", "Subscription", "Non-Consumable", "Consumable", "Non-Renewing", "SOMETHING_NEW"],
  );
});
