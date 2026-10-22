import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc subscriptions list takes the app's bundle ID, through the parser", async () => {
  const { api } = ascRoutes({
    "GET /v1/apps?filter[bundleId]=com.acme.app&fields[apps]=bundleId&limit=10": page([one("apps", "555")]),
    "GET /v1/apps/555/subscriptionGroups?limit=200": page([one("subscriptionGroups", "201", { referenceName: "Pro" })]),
    "GET /v1/subscriptionGroups/201/subscriptions?limit=200": page([one("subscriptions", "601", { productId: "pro.monthly" })]),
  });
  const result = await runLine("asc subscriptions list com.acme.app --json", { api });
  assert.deepEqual(result.json, [{ id: "601", productId: "pro.monthly", group: { id: "201", referenceName: "Pro" } }]);
});

test("asc subscriptions create --help lists what it composes", async () => {
  const help = await helpLine("asc subscriptions create --help");
  assert.match(help, /--trial <duration>/);
  assert.match(help, /--available-territories <all\|USA,CAN>/);
});
