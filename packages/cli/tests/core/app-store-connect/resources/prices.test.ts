import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as prices } from "@/commands/app-store-connect/store/prices";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { EQUALIZATIONS, iapView, subscriptionView, USA_POINTS } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const SUBSCRIPTION_PRICES =
  "GET /v1/subscriptions/601/prices?include=subscriptionPricePoint,territory&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds";

test("set prices a subscription in its base territory and equalizes every territory it's sold in, in one PATCH", async () => {
  const { api, writes, sent } = ascRoutes({
    ...subscriptionView("601"),
    "GET /v1/subscriptionPlanAvailabilities/A1/availableTerritories?limit=200": page([one("territories", "USA"), one("territories", "CAN"), one("territories", "ATA")]),
    [USA_POINTS("601")]: page([one("subscriptionPricePoints", "P-USA", { customerPrice: "4.99" })]),
    [EQUALIZATIONS("P-USA")]: page([one("subscriptionPricePoints", "P-GBR", {}, { territory: link("territories", "GBR") })], {
      next: "/v1/subscriptionPricePoints/P-USA/equalizations?cursor=AB",
    }),
    "GET /v1/subscriptionPricePoints/P-USA/equalizations?cursor=AB": page([one("subscriptionPricePoints", "P-CAN", {}, { territory: link("territories", "CAN") })]),
    "PATCH /v1/subscriptions/601": { data: one("subscriptions", "601") },
  });
  const result = await runCommand(prices, {
    api,
    words: ["set"],
    flags: { subscription: "601", price: "4.99", preserveCurrentPrice: true, startDate: "2026-12-01" },
  });
  assert.ok(sent.some((request) => request.path.endsWith("cursor=AB")), "follows Apple's next link");
  const entry = (territory: string, point: string) => ({
    type: "subscriptionPrices",
    id: `\${price-${territory}}`,
    attributes: { startDate: "2026-12-01", preserveCurrentPrice: true, planType: "UPFRONT" },
    relationships: { subscriptionPricePoint: link("subscriptionPricePoints", point), territory: link("territories", territory) },
  });
  assert.deepEqual(writes(), [
    {
      method: "PATCH",
      path: "/v1/subscriptions/601",
      body: {
        data: {
          type: "subscriptions",
          id: "601",
          relationships: { prices: { data: [{ type: "subscriptionPrices", id: "${price-USA}" }, { type: "subscriptionPrices", id: "${price-CAN}" }] } },
        },
        included: [entry("USA", "P-USA"), entry("CAN", "P-CAN")],
      },
    },
  ]);
  assert.deepEqual(result.said("success"), ["Priced at 4.99 in USA, equalized across 2 territories"]);
});

test("set on a subscription sold nowhere asks for availability first", async () => {
  const { api } = ascRoutes({ "GET /v1/subscriptions/601/planAvailabilities?limit=50": page([]) });
  const result = await runCommand(prices, { api, words: ["set"], flags: { subscription: "601", price: "4.99" } });
  assert.deepEqual(result.said("error"), [
    "Subscription 601 isn't available anywhere yet: superwall asc availability set --subscription 601 --available-territories all",
  ]);
});

test("set on an in-app purchase posts a new schedule with its base territory", async () => {
  const { api, writes } = ascRoutes({
    ...iapView("701"),
    "GET /v2/inAppPurchases/701/pricePoints?filter[territory]=GBR&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds": page([
      one("inAppPurchasePricePoints", "IP-GBR", { customerPrice: "0.99" }),
    ]),
    "POST /v1/inAppPurchasePriceSchedules": { data: one("inAppPurchasePriceSchedules", "SCH") },
  });
  const result = await runCommand(prices, { api, words: ["set"], flags: { iap: "701", price: "0.99", territory: "GBR" } });
  const body = writes()[0]?.body as { data: { relationships: { baseTerritory: unknown } } };
  assert.deepEqual(body.data.relationships.baseTerritory, link("territories", "GBR"));
  assert.deepEqual(result.said("success"), ["Priced at 0.99 in GBR; Apple equalizes the other territories"]);
});

test("a dry-run set sends no change", async () => {
  const { api, writes } = ascRoutes({
    "GET /v2/inAppPurchases/701/pricePoints?filter[territory]=USA&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds": page([
      one("inAppPurchasePricePoints", "IP", { customerPrice: "2" }),
    ]),
    ...subscriptionView("601"),
    [USA_POINTS("601")]: page([one("subscriptionPricePoints", "P-USA", { customerPrice: "2" })]),
    [EQUALIZATIONS("P-USA")]: page([]),
  });
  await runCommand(prices, { api, words: ["set"], flags: { iap: "701", price: "2", dryRun: true } });
  const plan = await runCommand(prices, { api, words: ["set"], flags: { subscription: "601", price: "2", dryRun: true }, json: true });
  assert.deepEqual(writes(), []);
  const { requests } = plan.json as { requests: { method: string }[] };
  assert.equal(requests.at(-1)?.method, "PATCH");
});

test("list shows a subscription's prices, and an in-app purchase's manual and equalized ones", async () => {
  const { api } = ascRoutes({
    ...iapView("701"),
    "GET /v2/inAppPurchases/709/iapPriceSchedule?include=baseTerritory": { data: null },
    [SUBSCRIPTION_PRICES]: page([one("subscriptionPrices", "PR1", { startDate: "2026-12-01" }, { territory: link("territories", "USA") })]),
  });
  const sub = await runCommand(prices, { api, words: ["list"], flags: { subscription: "601" } });
  assert.deepEqual(sub.said("info"), ["`USA`  from 2026-12-01"]);
  const iap = await runCommand(prices, { api, words: ["list"], flags: { iap: "701" } });
  assert.deepEqual(iap.said("info"), ["`USA`  0.99  from 2026-01-01", "`CAN`  equalized"]);
  const unpriced = await runCommand(prices, { api, words: ["list"], flags: { iap: "709" }, json: true });
  assert.deepEqual(unpriced.json, []);
});

test("points lists a territory's price points, or finds the one at --price", async () => {
  const { api } = ascRoutes({
    "GET /v1/subscriptions/601/pricePoints?filter[territory]=JPN&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds": page([
      one("subscriptionPricePoints", "J1", { customerPrice: "100", proceeds: "85" }),
      one("subscriptionPricePoints", "J2", { customerPrice: "120" }),
    ]),
  });
  const all = await runCommand(prices, { api, words: ["points"], flags: { subscription: "601", territory: "JPN" } });
  assert.deepEqual(all.said("info"), ["`100`  proceeds 85  J1", "`120`  proceeds ?  J2"]);
  const found = await runCommand(prices, { api, words: ["points"], flags: { subscription: "601", territory: "JPN", price: "120" }, json: true });
  assert.deepEqual(found.json, [{ id: "J2", customerPrice: "120" }]);
  const none = await runCommand(prices, { api, words: ["points"], flags: { subscription: "601", territory: "JPN", price: "99" } });
  assert.deepEqual(none.said("error"), ["Apple has no JPN price point at 99."]);
});

test("a price point lookup with no prices at all says so plainly", async () => {
  const { api } = ascRoutes({ ...subscriptionView("601"), [USA_POINTS("601")]: page([]) });
  const result = await runCommand(prices, { api, words: ["set"], flags: { subscription: "601", price: "3" } });
  assert.deepEqual(result.said("error"), ["Apple has no USA price point at 3."]);
});
