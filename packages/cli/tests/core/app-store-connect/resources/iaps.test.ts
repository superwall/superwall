import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as iaps } from "@/commands/app-store-connect/store/iaps";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { APP_BY_BUNDLE, iapView } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const IAP_POINTS = "GET /v2/inAppPurchases/701/pricePoints?filter[territory]=USA&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds";

test("create makes the purchase, its localization, availability and price schedule, then reads it back", async () => {
  const { api, writes } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    "POST /v2/inAppPurchases": { data: one("inAppPurchases", "701") },
    "POST /v2/inAppPurchaseLocalizations": { data: one("inAppPurchaseLocalizations", "IL1") },
    "POST /v1/inAppPurchaseAvailabilities": { data: one("inAppPurchaseAvailabilities", "IA1") },
    "GET /v1/territories?limit=200&fields[territories]=currency": page([one("territories", "USA"), one("territories", "CAN")]),
    [IAP_POINTS]: page([one("inAppPurchasePricePoints", "IP-USA", { customerPrice: "0.99" })]),
    "POST /v1/inAppPurchasePriceSchedules": { data: one("inAppPurchasePriceSchedules", "SCH") },
    ...iapView("701"),
  });
  const result = await runCommand(iaps, {
    api,
    words: ["create"],
    flags: {
      ascApp: "com.acme.app",
      productId: "coins.100",
      name: "Coins",
      inAppPurchaseType: "consumable",
      price: "0.99",
      displayName: "100 Coins",
      description: "A pile",
      familySharable: false,
      reviewNote: "Tap buy",
    },
    json: true,
  });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v2/inAppPurchases",
      body: {
        data: {
          type: "inAppPurchases",
          attributes: { productId: "coins.100", inAppPurchaseType: "CONSUMABLE", name: "Coins", reviewNote: "Tap buy", familySharable: false },
          relationships: { app: link("apps", "555") },
        },
      },
    },
    {
      method: "POST",
      path: "/v2/inAppPurchaseLocalizations",
      body: {
        data: {
          type: "inAppPurchaseLocalizations",
          attributes: { locale: "en-US", name: "100 Coins", description: "A pile" },
          relationships: { version: link("inAppPurchaseVersions", "IV1") },
        },
      },
    },
    {
      method: "POST",
      path: "/v1/inAppPurchaseAvailabilities",
      body: {
        data: {
          type: "inAppPurchaseAvailabilities",
          attributes: { availableInNewTerritories: true },
          relationships: {
            inAppPurchase: link("inAppPurchases", "701"),
            availableTerritories: { data: [{ type: "territories", id: "USA" }, { type: "territories", id: "CAN" }] },
          },
        },
      },
    },
    {
      method: "POST",
      path: "/v1/inAppPurchasePriceSchedules",
      body: {
        data: {
          type: "inAppPurchasePriceSchedules",
          relationships: {
            inAppPurchase: link("inAppPurchases", "701"),
            baseTerritory: link("territories", "USA"),
            manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${price-USA}" }] },
          },
        },
        included: [
          {
            type: "inAppPurchasePrices",
            id: "${price-USA}",
            attributes: { startDate: null },
            relationships: { inAppPurchasePricePoint: link("inAppPurchasePricePoints", "IP-USA"), inAppPurchaseV2: link("inAppPurchases", "701") },
          },
        ],
      },
    },
  ]);
  const view = result.json as Record<string, unknown>;
  assert.deepEqual(view.missing, ["localization"]);
  assert.deepEqual(view.priceSchedule, {
    id: "SCH",
    baseTerritory: "USA",
    prices: [
      { id: "MP1", territory: "USA", customerPrice: "0.99", proceeds: "0.84", startDate: "2026-01-01", manual: true },
      { id: "AP1", territory: "CAN", manual: false },
    ],
  });
  assert.deepEqual(view.availability, { id: "IA1", availableInNewTerritories: true, territories: ["USA"] });
  assert.equal(view.reviewNote, "Tap buy");
});

test("create without a price or display name, in some territories, skips those steps", async () => {
  const { api, writes } = ascRoutes({
    "POST /v2/inAppPurchases": { data: one("inAppPurchases", "701") },
    "POST /v1/inAppPurchaseAvailabilities": { data: one("inAppPurchaseAvailabilities", "IA1") },
    ...iapView("701", {
      "GET /v2/inAppPurchases/701/iapPriceSchedule?include=baseTerritory": { data: null },
      "GET /v2/inAppPurchases/701/inAppPurchaseAvailability": { data: null },
      "GET /v2/inAppPurchases/701/appStoreReviewScreenshot": { data: null },
      "GET /v2/inAppPurchases/701/versions": page([]),
      "GET /v2/inAppPurchases/701": { data: one("inAppPurchases", "701", { productId: "unlock" }) },
    }),
  });
  const human = await runCommand(iaps, {
    api,
    words: ["create"],
    flags: { ascApp: "555", productId: "unlock", name: "Unlock", inAppPurchaseType: "NON_CONSUMABLE", availableTerritories: "usa", availableInNewTerritories: "true" },
  });
  assert.deepEqual(
    writes().map((request) => request.path),
    ["/v2/inAppPurchases", "/v1/inAppPurchaseAvailabilities"],
  );
  assert.deepEqual(human.said("success"), ["Created unlock (state unknown); still missing: localization, price, availability, review screenshot"]);
});

test("create stops when Apple returns no purchase or no version to localize", async () => {
  const empty = ascRoutes({ "POST /v2/inAppPurchases": {} });
  const flags = { ascApp: "555", productId: "p", name: "P", inAppPurchaseType: "CONSUMABLE", displayName: "P" };
  assert.deepEqual((await runCommand(iaps, { api: empty.api, words: ["create"], flags })).said("error"), ["Apple created no in-app purchase."]);
  const noVersion = ascRoutes({ "POST /v2/inAppPurchases": { data: one("inAppPurchases", "701") }, "GET /v2/inAppPurchases/701/versions": page([]) });
  assert.deepEqual((await runCommand(iaps, { api: noVersion.api, words: ["create"], flags })).said("error"), [
    "Apple made no version of in-app purchase 701 to localize.",
  ]);
});

test("a dry-run create plans the price lookup on the purchase it would create", async () => {
  const { api, writes } = ascRoutes({});
  const result = await runCommand(iaps, {
    api,
    words: ["create"],
    flags: { ascApp: "555", productId: "p", name: "P", inAppPurchaseType: "CONSUMABLE", price: "1.99", availableTerritories: "USA", dryRun: true },
    json: true,
  });
  assert.deepEqual(writes(), []);
  const { requests } = result.json as { requests: { method: string; path: string }[] };
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    [
      "POST /v2/inAppPurchases",
      "POST /v1/inAppPurchaseAvailabilities",
      "GET /v2/inAppPurchases/${iap}/pricePoints?filter[territory]=USA&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds",
      "POST /v1/inAppPurchasePriceSchedules",
    ],
  );
});

test("list reads the V2 in-app purchases with Apple's filters", async () => {
  const { api } = ascRoutes({
    "GET /v1/apps/555/inAppPurchasesV2?limit=200&filter[productId]=coins.100&filter[state]=APPROVED&filter[inAppPurchaseType]=CONSUMABLE": page([
      one("inAppPurchases", "701", { productId: "coins.100", name: "Coins", inAppPurchaseType: "CONSUMABLE", state: "APPROVED" }),
      one("inAppPurchases", "702"),
    ]),
  });
  const result = await runCommand(iaps, {
    api,
    words: ["list", "555"],
    flags: { productId: "coins.100", state: "APPROVED", inAppPurchaseType: "consumable" },
  });
  assert.deepEqual(result.said("step"), ["2 in-app purchases"]);
  assert.deepEqual(result.said("info"), ["`coins.100`  Coins  CONSUMABLE  APPROVED  701", "`702`  702"]);
});

test("get reads one purchase, and an unknown one says so", async () => {
  const { api } = ascRoutes({ ...iapView("701"), "GET /v2/inAppPurchases/709": { data: null } });
  const view = (await runCommand(iaps, { api, words: ["701"], json: true })).json as Record<string, unknown>;
  assert.deepEqual(view.reviewScreenshot, { id: "SS1", fileName: "coins.png", state: "COMPLETE" });
  assert.deepEqual(view.version, { id: "IV1", version: 1, state: "PREPARE_FOR_SUBMISSION" });
  const missing = await runCommand(iaps, { api, words: ["get", "709"] });
  assert.deepEqual(missing.said("error"), ["No in-app purchase 709."]);
});

test("update and delete", async () => {
  const { api, writes } = ascRoutes({ "PATCH /v2/inAppPurchases/701": { data: one("inAppPurchases", "701") }, "DELETE /v2/inAppPurchases/701": undefined });
  const updated = await runCommand(iaps, { api, words: ["update", "701"], flags: { name: "Gems", familySharable: true }, json: true });
  assert.deepEqual(updated.json, { id: "701", name: "Gems", familySharable: true });
  const nothing = await runCommand(iaps, { api, words: ["update", "701"] });
  assert.deepEqual(nothing.said("error"), ["Nothing to change: pass --name, --review-note or --family-sharable."]);
  const deleted = await runCommand(iaps, { api, words: ["delete", "701"], flags: { yes: true } });
  assert.deepEqual(deleted.said("success"), ["Deleted in-app purchase 701"]);
  assert.deepEqual(writes(), [
    { method: "PATCH", path: "/v2/inAppPurchases/701", body: { data: { type: "inAppPurchases", id: "701", attributes: { name: "Gems", familySharable: true } } } },
    { method: "DELETE", path: "/v2/inAppPurchases/701" },
  ]);
});
