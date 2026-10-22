import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as products } from "@/commands/app-store-connect/store/products";
import { STORE, fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = undefined;
});

test("lists every product of an app found by its bundle ID", async () => {
  const { api } = fakeAscApi(STORE);
  const human = await runCommand(products, { api, args: { id: "com.acme.app" } });
  assert.deepEqual(human.said("step"), ["2 products"]);
  assert.deepEqual(human.said("info"), ["`pro.monthly`  Subscription  ONE_MONTH", "`coins.100`  Consumable"]);
});

test("an id is used as is, and an unknown bundle ID says so", async () => {
  const { api, requests } = fakeAscApi(STORE);
  const json = await runCommand(products, { api, args: { id: "555" }, json: true });
  assert.equal((json.json as unknown[]).length, 2);
  assert.ok(!requests.some((request) => request.path.includes("filter[bundleId]")));

  const missing = await runCommand(products, { api, args: { id: "com.acme.other" } });
  assert.deepEqual(missing.said("error"), ['No App Store Connect app found for "com.acme.other".']);
});
