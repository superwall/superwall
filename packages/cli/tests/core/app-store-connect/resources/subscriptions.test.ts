import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as subscriptions } from "@/commands/app-store-connect/store/subscriptions";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { APP_BY_BUNDLE, EQUALIZATIONS, GROUPS_OF_APP, subscriptionView, USA_POINTS } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const CREATE_FLAGS = {
  group: "Pro",
  ascApp: "com.acme.app",
  productId: "pro.monthly",
  name: "Pro Monthly",
  subscriptionPeriod: "one-month",
  price: "9.99",
  availableTerritories: "USA,CAN,MEX",
  displayName: "Pro",
  description: "Everything",
  trial: "one_week",
};

const CREATE_ROUTES = {
  [APP_BY_BUNDLE]: page([one("apps", "555")]),
  [GROUPS_OF_APP]: page([one("subscriptionGroups", "G0", { referenceName: "Basic" }), one("subscriptionGroups", "G1", { referenceName: "Pro" })]),
  "POST /v1/subscriptions": { data: one("subscriptions", "S1", { productId: "pro.monthly" }) },
  "POST /v2/subscriptionLocalizations": { data: one("subscriptionLocalizations", "L1") },
  "POST /v1/subscriptionPlanAvailabilities": { data: one("subscriptionPlanAvailabilities", "A1") },
  [USA_POINTS("S1")]: page([one("subscriptionPricePoints", "P-USA-949", { customerPrice: "9.49" })], { next: "/v1/subscriptions/S1/pricePoints?cursor=AA" }),
  "GET /v1/subscriptions/S1/pricePoints?cursor=AA": page([one("subscriptionPricePoints", "P-USA", { customerPrice: "9.99" })]),
  [EQUALIZATIONS("P-USA")]: page([
    one("subscriptionPricePoints", "P-CAN", { customerPrice: "13.99" }, { territory: link("territories", "CAN") }),
    one("subscriptionPricePoints", "P-GBR", { customerPrice: "9.99" }, { territory: link("territories", "GBR") }),
    one("subscriptionPricePoints", "P-NONE", { customerPrice: "1" }),
  ]),
  "PATCH /v1/subscriptions/S1": { data: one("subscriptions", "S1") },
  ...subscriptionView("S1"),
};

const price = (territory: string, point: string) => ({
  type: "subscriptionPrices",
  id: `\${price-${territory}}`,
  attributes: { startDate: null, preserveCurrentPrice: false, planType: "UPFRONT" },
  relationships: { subscriptionPricePoint: link("subscriptionPricePoints", point), territory: link("territories", territory) },
});

const trial = (territory: string) => ({
  type: "subscriptionIntroductoryOffers",
  id: `\${offer-${territory}}`,
  attributes: { duration: "ONE_WEEK", offerMode: "FREE_TRIAL", numberOfPeriods: 1 },
  relationships: { subscription: link("subscriptions", "S1"), territory: link("territories", territory) },
});

test("create runs every step in order: subscription, localization, availability, prices with the trial in one PATCH", async () => {
  const { api, sent, writes } = ascRoutes(CREATE_ROUTES);
  const result = await runCommand(subscriptions, { api, words: ["create"], flags: CREATE_FLAGS, json: true });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/subscriptions",
      body: {
        data: {
          type: "subscriptions",
          attributes: { productId: "pro.monthly", name: "Pro Monthly", subscriptionPeriod: "ONE_MONTH" },
          relationships: { group: link("subscriptionGroups", "G1") },
        },
      },
    },
    {
      method: "POST",
      path: "/v2/subscriptionLocalizations",
      body: {
        data: {
          type: "subscriptionLocalizations",
          attributes: { locale: "en-US", name: "Pro", description: "Everything" },
          relationships: { version: link("subscriptionVersions", "V1") },
        },
      },
    },
    {
      method: "POST",
      path: "/v1/subscriptionPlanAvailabilities",
      body: {
        data: {
          type: "subscriptionPlanAvailabilities",
          attributes: { planType: "UPFRONT", availableInNewTerritories: false },
          relationships: {
            subscription: link("subscriptions", "S1"),
            availableTerritories: { data: ["USA", "CAN", "MEX"].map((id) => ({ type: "territories", id })) },
          },
        },
      },
    },
    {
      method: "PATCH",
      path: "/v1/subscriptions/S1",
      body: {
        data: {
          type: "subscriptions",
          id: "S1",
          relationships: {
            prices: { data: [{ type: "subscriptionPrices", id: "${price-USA}" }, { type: "subscriptionPrices", id: "${price-CAN}" }] },
            introductoryOffers: {
              data: [
                { type: "subscriptionIntroductoryOffers", id: "${offer-USA}" },
                { type: "subscriptionIntroductoryOffers", id: "${offer-CAN}" },
              ],
            },
          },
        },
        included: [price("USA", "P-USA"), price("CAN", "P-CAN"), trial("USA"), trial("CAN")],
      },
    },
  ]);
  assert.ok(sent.some((request) => request.path === "/v1/subscriptions/S1/pricePoints?cursor=AA"), "pages until the price matches");
  const view = result.json as Record<string, unknown>;
  assert.equal(view.state, "MISSING_METADATA");
  assert.deepEqual(view.missing, ["review screenshot"]);
  assert.deepEqual(view.skippedTerritories, ["MEX"]);
  assert.deepEqual(view.group, { id: "G1", referenceName: "Pro" });
  assert.deepEqual(view.version, { id: "V1", version: 1, state: "PREPARE_FOR_SUBMISSION" });
  assert.deepEqual(view.prices, [{ id: "PR1", territory: "USA", customerPrice: "9.99", proceeds: "8.49", planType: "UPFRONT" }]);
  assert.deepEqual(view.introductoryOffers, [{ id: "O1", territory: "USA", offerMode: "FREE_TRIAL", duration: "ONE_WEEK", numberOfPeriods: 1 }]);
});

test("create says what is still missing in its heading", async () => {
  const { api } = ascRoutes(CREATE_ROUTES);
  const human = await runCommand(subscriptions, { api, words: ["create"], flags: CREATE_FLAGS });
  assert.deepEqual(human.said("success"), ["Created pro.monthly (MISSING_METADATA); still missing: review screenshot"]);
});

test("a dry run reads what it can, plans the rest with placeholders and changes nothing", async () => {
  const { api, writes } = ascRoutes({
    "GET /v1/territories?limit=200&fields[territories]=currency": page([one("territories", "USA"), one("territories", "CAN")]),
  });
  const result = await runCommand(subscriptions, {
    api,
    words: ["create"],
    flags: { group: "201", productId: "pro.monthly", name: "Pro", subscriptionPeriod: "ONE_YEAR", price: "49.99", dryRun: true },
    json: true,
  });
  assert.deepEqual(writes(), []);
  const { dryRun, requests } = result.json as { dryRun: boolean; requests: { method: string; path: string; body?: unknown }[] };
  assert.equal(dryRun, true);
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    [
      "POST /v1/subscriptions",
      "GET /v1/territories?limit=200&fields[territories]=currency",
      "POST /v1/subscriptionPlanAvailabilities",
      "GET /v1/subscriptions/${subscription}/pricePoints?filter[territory]=USA&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds",
      "GET /v1/subscriptionPricePoints/${price-point-USA}/equalizations?include=territory&limit=200&fields[subscriptionPricePoints]=customerPrice,territory",
      "PATCH /v1/subscriptions/${subscription}",
    ],
  );
  const patch = requests.at(-1)?.body as { included: { relationships: { subscriptionPricePoint: unknown } }[] };
  assert.deepEqual(
    patch.included.map((entry) => entry.relationships.subscriptionPricePoint),
    [link("subscriptionPricePoints", "${price-point-USA}"), link("subscriptionPricePoints", "${price-point-CAN}")],
  );
  const availability = requests[2]?.body as { data: { attributes: unknown } };
  assert.deepEqual(availability.data.attributes, { planType: "UPFRONT", availableInNewTerritories: true });
});

test("a dry run in the terminal prints each request and its body", async () => {
  const { api } = ascRoutes({});
  const human = await runCommand(subscriptions, {
    api,
    words: ["create"],
    flags: { group: "201", productId: "p", name: "P", subscriptionPeriod: "ONE_YEAR", price: "1", availableTerritories: "USA", dryRun: true },
  });
  assert.deepEqual(human.said("success"), ["Dry run: nothing was changed. 5 requests:"]);
  assert.equal(human.said("step")[0], "POST /v1/subscriptions");
  assert.match(human.said("report")[0] ?? "", /"productId": "p"/);
});

test("a price Apple has no point for names the closest ones, after creating only the subscription", async () => {
  const { api } = ascRoutes({
    "POST /v1/subscriptions": { data: one("subscriptions", "S1") },
    "POST /v1/subscriptionPlanAvailabilities": { data: one("subscriptionPlanAvailabilities", "A1") },
    [USA_POINTS("S1")]: page(["9.49", "9.95", "10.00", "10.49", "x"].map((customerPrice, index) => one("subscriptionPricePoints", `P${index}`, { customerPrice }))),
  });
  const result = await runCommand(subscriptions, {
    api,
    words: ["create"],
    flags: { group: "201", productId: "p", name: "P", subscriptionPeriod: "ONE_YEAR", price: "9.98", availableTerritories: "USA" },
  });
  assert.deepEqual(result.said("error"), ["Apple has no USA price point at 9.98. The closest: 9.49, 9.95, 10.00."]);
});

test("Apple's refusal is spelled out with what was already created", async () => {
  const { ApiError } = await import("@/core/api/client");
  const refusal = new ApiError(
    "POST /v2/organizations/7/app-store-connect/proxy/T1/v1/subscriptionPlanAvailabilities",
    409,
    JSON.stringify({ errors: [{ title: "Conflict", detail: "A territory is not valid", source: { pointer: "/data/relationships" } }, { code: "ENTITY_ERROR" }] }),
  );
  const { api } = ascRoutes({
    "POST /v1/subscriptions": { data: one("subscriptions", "S1") },
    "POST /v1/subscriptionPlanAvailabilities": refusal,
  });
  const result = await runCommand(subscriptions, {
    api,
    words: ["create"],
    flags: { group: "201", productId: "p", name: "P", subscriptionPeriod: "ONE_YEAR", price: "1", availableTerritories: "XXX" },
  });
  assert.deepEqual(result.said("error"), [
    "App Store Connect refused POST /v1/subscriptionPlanAvailabilities (409):\n  • A territory is not valid (/data/relationships)\n  • ENTITY_ERROR\nAlready created: subscriptions S1.",
  ]);
});

test("a group named without its app is refused before anything is sent", async () => {
  const { api, sent } = ascRoutes({});
  const result = await runCommand(subscriptions, {
    api,
    words: ["create"],
    flags: { group: "Pro", productId: "p", name: "P", subscriptionPeriod: "ONE_YEAR", price: "1" },
  });
  assert.deepEqual(result.said("error"), ['To find the group "Pro" by name, pass --asc-app <id|bundle id>, or pass the group\'s id.']);
  assert.deepEqual(sent, []);
});

test("a group name the app doesn't have, and an app Apple doesn't know, say so", async () => {
  const { api } = ascRoutes({ [APP_BY_BUNDLE]: page([one("apps", "555")]), [GROUPS_OF_APP]: page([]), "GET /v1/apps?filter[bundleId]=x&fields[apps]=bundleId&limit=10": page([]) });
  const group = await runCommand(subscriptions, { api, words: ["list", "com.acme.app"], flags: { group: "Pro" } });
  assert.deepEqual(group.said("error"), ['No subscription group named "Pro" in app 555.']);
  const app = await runCommand(subscriptions, { api, words: ["list", "x"] });
  assert.deepEqual(app.said("error"), ['No App Store Connect app found for "x".']);
});

test("Apple answering a create without the subscription stops there", async () => {
  const { api } = ascRoutes({ "POST /v1/subscriptions": {} });
  const result = await runCommand(subscriptions, {
    api,
    words: ["create"],
    flags: { group: "201", productId: "p", name: "P", subscriptionPeriod: "ONE_YEAR", price: "1" },
  });
  assert.deepEqual(result.said("error"), ["Apple created no subscription."]);
});

test("a new subscription with no version yet can't be localized", async () => {
  const { api } = ascRoutes({ "POST /v1/subscriptions": { data: one("subscriptions", "S1") }, "GET /v1/subscriptions/S1/versions": page([]) });
  const result = await runCommand(subscriptions, {
    api,
    words: ["create"],
    flags: { group: "201", productId: "p", name: "P", subscriptionPeriod: "ONE_YEAR", price: "1", displayName: "P" },
  });
  assert.deepEqual(result.said("error"), ["Apple made no version of subscription S1 to localize."]);
});

test("list walks every group of the app, or one group by id", async () => {
  const subscriptionsOf = (group: string) => `GET /v1/subscriptionGroups/${group}/subscriptions?limit=200`;
  const { api } = ascRoutes({
    "GET /v1/apps/555/subscriptionGroups?limit=200": page([one("subscriptionGroups", "G1", { referenceName: "Pro" }), one("subscriptionGroups", "202")]),
    [subscriptionsOf("G1")]: page([one("subscriptions", "S1", { productId: "pro.monthly", name: "Monthly", state: "APPROVED", subscriptionPeriod: "ONE_MONTH", groupLevel: 1 })]),
    [subscriptionsOf("202")]: page([one("subscriptions", "S2")]),
  });
  const all = await runCommand(subscriptions, { api, words: ["list", "555"] });
  assert.deepEqual(all.said("step"), ["2 subscriptions"]);
  assert.deepEqual(all.said("info"), ["`pro.monthly`  Monthly  ONE_MONTH  APPROVED  Pro  S1", "`S2`  S2"]);
  const one2 = await runCommand(subscriptions, { api, words: ["list"], flags: { group: "202" }, json: true });
  assert.deepEqual(one2.json, [{ id: "S2", group: { id: "202" } }]);
  const none = await runCommand(subscriptions, { api, words: ["list"] });
  assert.deepEqual(none.said("error"), ["Pass the App Store app (asc subscriptions list <id|bundle id>), or --group <id>."]);
});

test("get shows everything about one subscription, and an id alone means get", async () => {
  const { api } = ascRoutes(
    subscriptionView("601", {
      "GET /v1/subscriptions/601/appStoreReviewScreenshot": { data: one("subscriptionAppStoreReviewScreenshots", "SS1", { fileName: "pro.png", assetDeliveryState: { state: "COMPLETE" } }) },
    }),
  );
  const result = await runCommand(subscriptions, { api, words: ["601"], json: true });
  const view = result.json as Record<string, unknown>;
  assert.deepEqual(view.reviewScreenshot, { id: "SS1", fileName: "pro.png", state: "COMPLETE" });
  assert.deepEqual(view.availability, { id: "A1", planType: "UPFRONT", availableInNewTerritories: false, territories: ["USA", "CAN"] });
  assert.deepEqual(view.missing, []);
  assert.equal(view.familySharable, false);
});

test("get of a subscription with nothing set lists everything missing", async () => {
  const { ApiError } = await import("@/core/api/client");
  const { api } = ascRoutes(
    subscriptionView("S9", {
      "GET /v1/subscriptions/S9?include=group": { data: one("subscriptions", "S9", { reviewNote: "Look here" }) },
      "GET /v1/subscriptions/S9/versions": page([]),
      "GET /v1/subscriptions/S9/prices?include=subscriptionPricePoint,territory&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds": page([one("subscriptionPrices", "PR")]),
      "GET /v1/subscriptions/S9/introductoryOffers?include=territory,subscriptionPricePoint&limit=200&fields[subscriptionPricePoints]=customerPrice": page([one("subscriptionIntroductoryOffers", "O")]),
      "GET /v1/subscriptions/S9/planAvailabilities?limit=50": page([one("subscriptionPlanAvailabilities", "M", { planType: "MONTHLY" })]),
      "GET /v1/subscriptions/S9/appStoreReviewScreenshot": new ApiError("GET x", 404, ""),
    }),
  );
  const view = (await runCommand(subscriptions, { api, words: ["get", "S9"], json: true })).json as Record<string, unknown>;
  assert.deepEqual(view.missing, ["localization", "availability", "review screenshot"]);
  assert.deepEqual(view.prices, [{ id: "PR" }]);
  assert.deepEqual(view.introductoryOffers, [{ id: "O" }]);
  assert.equal(view.reviewNote, "Look here");
  assert.deepEqual(view.group, { id: "" });

  const { api: empty } = ascRoutes({ "GET /v1/subscriptions/S0?include=group": { data: null } });
  const missing = await runCommand(subscriptions, { api: empty, words: ["get", "S0"] });
  assert.deepEqual(missing.said("error"), ["No subscription S0."]);
});

test("a server error reading the screenshot is not mistaken for no screenshot", async () => {
  const { ApiError } = await import("@/core/api/client");
  const { api } = ascRoutes(subscriptionView("S1", { "GET /v1/subscriptions/S1/appStoreReviewScreenshot": new ApiError("GET x", 500, "boom") }));
  const result = await runCommand(subscriptions, { api, words: ["get", "S1"] });
  assert.deepEqual(result.said("error"), ["HTTP 500 — boom\nGET x"]);
});

test("update sends only the given attributes, and refuses nothing to change", async () => {
  const { api, writes } = ascRoutes({ "PATCH /v1/subscriptions/S1": { data: one("subscriptions", "S1") } });
  const result = await runCommand(subscriptions, {
    api,
    words: ["update", "S1"],
    flags: { name: "Pro", familySharable: "true", groupLevel: "2", reviewNote: "Hi", subscriptionPeriod: "SIX_MONTHS" },
    json: true,
  });
  const attributes = { name: "Pro", subscriptionPeriod: "SIX_MONTHS", familySharable: true, reviewNote: "Hi", groupLevel: 2 };
  assert.deepEqual(writes(), [{ method: "PATCH", path: "/v1/subscriptions/S1", body: { data: { type: "subscriptions", id: "S1", attributes } } }]);
  assert.deepEqual(result.json, { id: "S1", ...attributes });
  const nothing = await runCommand(subscriptions, { api, words: ["update", "S1"] });
  assert.match(nothing.said("error")[0] ?? "", /^Nothing to change/);
});

test("delete confirms outside a TTY, and goes ahead with --yes", async () => {
  const { api, writes } = ascRoutes({ "DELETE /v1/subscriptions/S1": undefined });
  const refused = await runCommand(subscriptions, { api, words: ["delete", "S1"] });
  assert.deepEqual(refused.said("error"), ["Delete subscription S1\nNothing was changed. Pass --yes to go ahead."]);
  assert.deepEqual(writes(), []);
  const done = await runCommand(subscriptions, { api, words: ["delete", "S1"], flags: { yes: true }, json: true });
  assert.deepEqual(done.json, { id: "S1", deleted: true });
  assert.deepEqual(writes(), [{ method: "DELETE", path: "/v1/subscriptions/S1" }]);
});
