import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as offers } from "@/commands/app-store-connect/store/offers";
import { ApiError } from "@/core/api/client";
import { planOfferReplacement, type OfferView } from "@/core/app-store-connect/resources/offers";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { EQUALIZATIONS, subscriptionView, USA_POINTS } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const OFFERS = "GET /v1/subscriptions/601/introductoryOffers?include=territory,subscriptionPricePoint&limit=200&fields[subscriptionPricePoints]=customerPrice";

test("a free trial goes to every territory the subscription is sold in, in one PATCH", async () => {
  const { api, writes } = ascRoutes({
    ...subscriptionView("601"),
    "DELETE /v1/subscriptionIntroductoryOffers/O1": undefined,
    "PATCH /v1/subscriptions/601": { data: one("subscriptions", "601") },
  });
  const result = await runCommand(offers, {
    api,
    words: ["create"],
    flags: { subscription: "601", offerMode: "free-trial", duration: "TWO_WEEKS", endDate: "2027-01-01", yes: true },
  });
  const offer = (territory: string) => ({
    type: "subscriptionIntroductoryOffers",
    id: `\${offer-${territory}}`,
    attributes: { offerMode: "FREE_TRIAL", duration: "TWO_WEEKS", numberOfPeriods: 1, endDate: "2027-01-01" },
    relationships: { subscription: link("subscriptions", "601"), territory: link("territories", territory) },
  });
  assert.deepEqual(writes(), [
    { method: "DELETE", path: "/v1/subscriptionIntroductoryOffers/O1" },
    {
      method: "PATCH",
      path: "/v1/subscriptions/601",
      body: {
        data: {
          type: "subscriptions",
          id: "601",
          relationships: {
            introductoryOffers: {
              data: [
                { type: "subscriptionIntroductoryOffers", id: "${offer-USA}" },
                { type: "subscriptionIntroductoryOffers", id: "${offer-CAN}" },
              ],
            },
          },
        },
        included: [offer("USA"), offer("CAN")],
      },
    },
  ]);
  assert.deepEqual(result.said("success"), ["Created a FREE_TRIAL introductory offer in 2 territories, replacing 1 overlapping offer"]);
});

test("a paid offer is priced in its territory and equalized, skipping territories Apple has no point for", async () => {
  const { api, writes } = ascRoutes({
    ...subscriptionView("601"),
    [USA_POINTS("601")]: page([one("subscriptionPricePoints", "P-USA", { customerPrice: "0.99" })]),
    [EQUALIZATIONS("P-USA")]: page([one("subscriptionPricePoints", "P-CAN", {}, { territory: link("territories", "CAN") })]),
    "DELETE /v1/subscriptionIntroductoryOffers/O1": undefined,
    "PATCH /v1/subscriptions/601": { data: one("subscriptions", "601") },
  });
  const result = await runCommand(offers, {
    api,
    words: ["create"],
    flags: {
      subscription: "601",
      offerMode: "PAY_UP_FRONT",
      duration: "ONE_MONTH",
      numberOfPeriods: "1",
      price: "0.99",
      availableTerritories: "USA,CAN,ATA",
      startDate: "2026-11-01",
      yes: true,
    },
    json: true,
  });
  assert.deepEqual(writes()[0], { method: "DELETE", path: "/v1/subscriptionIntroductoryOffers/O1" });
  const body = writes()[1]?.body as { included: { attributes: unknown; relationships: { subscriptionPricePoint?: unknown } }[] };
  assert.deepEqual(
    body.included.map((entry) => entry.relationships.subscriptionPricePoint),
    [link("subscriptionPricePoints", "P-USA"), link("subscriptionPricePoints", "P-CAN")],
  );
  assert.deepEqual(body.included[0]?.attributes, { offerMode: "PAY_UP_FRONT", duration: "ONE_MONTH", numberOfPeriods: 1, startDate: "2026-11-01" });
  assert.deepEqual((result.json as { skippedTerritories: string[] }).skippedTerritories, ["ATA"]);
  assert.deepEqual((result.json as { replaced: unknown }).replaced, { deleted: ["O1"], ended: [] });
});

test("a paid offer without --price, or for a subscription sold nowhere, is refused", async () => {
  const { api, writes } = ascRoutes({ ...subscriptionView("601"), "GET /v1/subscriptions/602/planAvailabilities?limit=50": page([]) });
  const unpriced = await runCommand(offers, { api, words: ["create"], flags: { subscription: "601", offerMode: "PAY_AS_YOU_GO", duration: "ONE_MONTH" } });
  assert.deepEqual(unpriced.said("error"), ["A PAY_AS_YOU_GO offer needs --price, in USA."]);
  const nowhere = await runCommand(offers, { api, words: ["create"], flags: { subscription: "602", offerMode: "FREE_TRIAL", duration: "ONE_MONTH" } });
  assert.deepEqual(nowhere.said("error"), ["Subscription 602 isn't available anywhere yet: pass --available-territories, or set its availability first."]);
  assert.deepEqual(writes(), []);
});

test("list, update and delete", async () => {
  const { api, writes } = ascRoutes({
    [OFFERS]: page(
      [
        one("subscriptionIntroductoryOffers", "O1", { offerMode: "PAY_UP_FRONT", duration: "ONE_MONTH", numberOfPeriods: 1, endDate: "2027-01-01" }, {
          territory: link("territories", "USA"),
          subscriptionPricePoint: link("subscriptionPricePoints", "P-USA"),
        }),
        one("subscriptionIntroductoryOffers", "O2"),
      ],
      { included: [one("subscriptionPricePoints", "P-USA", { customerPrice: "0.99" })] },
    ),
    "PATCH /v1/subscriptionIntroductoryOffers/O1": { data: one("subscriptionIntroductoryOffers", "O1", { endDate: "2027-02-01" }) },
    "PATCH /v1/subscriptionIntroductoryOffers/O2": undefined,
    "DELETE /v1/subscriptionIntroductoryOffers/O1": undefined,
    "DELETE /v1/subscriptionIntroductoryOffers/O2": undefined,
  });
  const listed = await runCommand(offers, { api, words: ["list"], flags: { subscription: "601" } });
  assert.deepEqual(listed.said("info"), ["`USA`  PAY_UP_FRONT  ONE_MONTH  0.99  until 2027-01-01  O1", "`O2`  O2"]);
  const updated = await runCommand(offers, { api, words: ["update", "O1"], flags: { endDate: "2027-02-01" }, json: true });
  assert.deepEqual(updated.json, { id: "O1", endDate: "2027-02-01" });
  const quiet = await runCommand(offers, { api, words: ["update", "O2"], flags: { endDate: "2027-03-01" }, json: true });
  assert.deepEqual(quiet.json, { id: "O2", endDate: "2027-03-01" });
  const one1 = await runCommand(offers, { api, words: ["delete", "O1"], flags: { yes: true }, json: true });
  assert.deepEqual(one1.json, { deleted: ["O1"] });
  const refused = await runCommand(offers, { api, words: ["delete"], flags: { subscription: "601" } });
  assert.deepEqual(refused.said("error"), ["Delete 2 introductory offers of subscription 601\nNothing was changed. Pass --yes to go ahead."]);
  const all = await runCommand(offers, { api, words: ["delete"], flags: { subscription: "601", yes: true } });
  assert.deepEqual(all.said("success"), ["Deleted 2 introductory offers"]);
  const neither = await runCommand(offers, { api, words: ["delete"] });
  assert.deepEqual(neither.said("error"), ["Pass the offer's <id>, or --subscription <id> to delete all of its introductory offers."]);
  assert.deepEqual(
    writes().map((request) => `${request.method} ${request.path}`),
    [
      "PATCH /v1/subscriptionIntroductoryOffers/O1",
      "PATCH /v1/subscriptionIntroductoryOffers/O2",
      "DELETE /v1/subscriptionIntroductoryOffers/O1",
      "DELETE /v1/subscriptionIntroductoryOffers/O1",
      "DELETE /v1/subscriptionIntroductoryOffers/O2",
    ],
  );
});

const TODAY = new Date().toISOString().slice(0, 10);

/** A subscription whose USA offer is running: $17.99 paid up front for a year, as in feedback #16. */
function runningOffer(extra: Record<string, unknown> = {}) {
  return ascRoutes({
    ...subscriptionView("601"),
    [OFFERS]: page(
      [
        one("subscriptionIntroductoryOffers", "O-USA", { offerMode: "PAY_UP_FRONT", duration: "ONE_YEAR", numberOfPeriods: 1, startDate: "2026-09-01" }, {
          territory: link("territories", "USA"),
          subscriptionPricePoint: link("subscriptionPricePoints", "P-1799"),
        }),
        one("subscriptionIntroductoryOffers", "O-CAN", { offerMode: "FREE_TRIAL", duration: "ONE_WEEK", numberOfPeriods: 1 }, { territory: link("territories", "CAN") }),
      ],
      { included: [one("subscriptionPricePoints", "P-1799", { customerPrice: "17.99" })] },
    ),
    [USA_POINTS("601")]: page([one("subscriptionPricePoints", "P-1749", { customerPrice: "17.49" })]),
    [EQUALIZATIONS("P-1749")]: page([]),
    "DELETE /v1/subscriptionIntroductoryOffers/O-USA": undefined,
    "PATCH /v1/subscriptionIntroductoryOffers/O-USA": { data: one("subscriptionIntroductoryOffers", "O-USA") },
    "PATCH /v1/subscriptions/601": { data: one("subscriptions", "601") },
    ...extra,
  });
}

const PAY_UP_FRONT = { subscription: "601", offerMode: "PAY_UP_FRONT", duration: "ONE_YEAR", numberOfPeriods: "1", price: "17.49", territory: "USA", availableTerritories: "USA" };

test("create replaces the running offer it overlaps in its territory, after asking (feedback #16)", async () => {
  const { api, writes } = runningOffer();
  const refused = await runCommand(offers, { api, words: ["create"], flags: { ...PAY_UP_FRONT, startDate: TODAY } });
  assert.deepEqual(refused.said("error"), [
    "Delete 1 existing introductory offer it overlaps: USA (O-USA)\nthen create the new PAY_UP_FRONT offer in 1 territory\nNothing was changed. Pass --yes to go ahead.",
  ]);
  assert.deepEqual(writes(), []);

  const result = await runCommand(offers, { api, words: ["create"], flags: { ...PAY_UP_FRONT, startDate: TODAY, yes: true }, json: true });
  assert.deepEqual(
    writes().map((request) => `${request.method} ${request.path}`),
    ["DELETE /v1/subscriptionIntroductoryOffers/O-USA", "PATCH /v1/subscriptions/601"],
  );
  const body = writes()[1]?.body as { included: { attributes: unknown; relationships: { territory: unknown; subscriptionPricePoint: unknown } }[] };
  assert.deepEqual(body.included.map((entry) => [entry.relationships.territory, entry.relationships.subscriptionPricePoint]), [
    [link("territories", "USA"), link("subscriptionPricePoints", "P-1749")],
  ]);
  assert.deepEqual((result.json as { replaced: unknown }).replaced, { deleted: ["O-USA"], ended: [] });
});

test("a later start ends the running offer the day before, and deletes an upcoming one it overlaps", async () => {
  const { api, writes } = runningOffer({
    [OFFERS]: page([
      one("subscriptionIntroductoryOffers", "O-USA", { offerMode: "PAY_UP_FRONT", duration: "ONE_YEAR", numberOfPeriods: 1 }, { territory: link("territories", "USA") }),
      one("subscriptionIntroductoryOffers", "O-NEXT", { offerMode: "FREE_TRIAL", duration: "ONE_WEEK", numberOfPeriods: 1, startDate: "2099-06-01" }, {
        territory: link("territories", "USA"),
      }),
    ]),
    "DELETE /v1/subscriptionIntroductoryOffers/O-NEXT": undefined,
  });
  const result = await runCommand(offers, { api, words: ["create"], flags: { ...PAY_UP_FRONT, startDate: "2099-01-01", yes: true } });
  assert.deepEqual(writes().slice(0, 2), [
    {
      method: "PATCH",
      path: "/v1/subscriptionIntroductoryOffers/O-USA",
      body: { data: { type: "subscriptionIntroductoryOffers", id: "O-USA", attributes: { endDate: "2098-12-31" } } },
    },
    { method: "DELETE", path: "/v1/subscriptionIntroductoryOffers/O-NEXT" },
  ]);
  assert.deepEqual(result.said("success"), ["Created a PAY_UP_FRONT introductory offer in 1 territory, replacing 2 overlapping offers"]);
});

test("a dry run plans the replacement without asking, and an offer elsewhere changes nothing", async () => {
  const { api, writes } = runningOffer();
  const planned = await runCommand(offers, { api, words: ["create"], flags: { ...PAY_UP_FRONT, dryRun: true }, json: true });
  const { requests } = planned.json as { requests: { method: string; path: string }[] };
  assert.deepEqual(
    requests.filter((request) => request.method !== "GET").map((request) => `${request.method} ${request.path}`),
    ["DELETE /v1/subscriptionIntroductoryOffers/O-USA", "PATCH /v1/subscriptions/601"],
  );
  assert.deepEqual(writes(), []);

  const elsewhere = runningOffer({
    [OFFERS]: page([one("subscriptionIntroductoryOffers", "O-CAN", { offerMode: "FREE_TRIAL" }, { territory: link("territories", "CAN") })]),
  });
  const created = await runCommand(offers, { api: elsewhere.api, words: ["create"], flags: PAY_UP_FRONT });
  assert.deepEqual(created.said("success"), ["Created a PAY_UP_FRONT introductory offer in 1 territory"]);
  assert.deepEqual(elsewhere.writes().map((request) => request.method), ["PATCH"]);
});

test("when Apple refuses the new offer after an old one went, the error says which", async () => {
  const refusal = new ApiError("PATCH x", 409, JSON.stringify({ errors: [{ detail: "Overlapping offer" }] }));
  const { api } = runningOffer({ "PATCH /v1/subscriptions/601": refusal });
  const result = await runCommand(offers, { api, words: ["create"], flags: { ...PAY_UP_FRONT, yes: true } });
  assert.deepEqual(result.said("error"), [
    "App Store Connect refused PATCH x (409):\n  • Overlapping offer\nThe new offer wasn't created, but existing offers were already changed: deleted USA (O-USA, PAY_UP_FRONT ONE_YEAR 17.99). Recreate them with `asc offers create` if you need them back.",
  ]);
  const before = runningOffer({ "DELETE /v1/subscriptionIntroductoryOffers/O-USA": refusal });
  const untouched = await runCommand(offers, { api: before.api, words: ["create"], flags: { ...PAY_UP_FRONT, yes: true } });
  assert.deepEqual(untouched.said("error"), ["App Store Connect refused PATCH x (409):\n  • Overlapping offer"]);
});

test("planOfferReplacement keeps offers elsewhere, already over, or clear of the new dates", () => {
  const today = "2026-11-08";
  const offer = (id: string, view: Partial<OfferView>): OfferView => ({ id, territory: "USA", ...view });
  const existing = [
    offer("running", {}),
    offer("canada", { territory: "CAN" }),
    offer("over", { startDate: "2026-10-01", endDate: "2026-11-01" }),
    offer("december", { startDate: "2026-12-01", endDate: "2026-12-31" }),
    { id: "nowhere" },
  ];
  const ids = (plan: ReturnType<typeof planOfferReplacement>) => ({
    remove: plan.remove.map((o) => o.id),
    end: plan.end.map(({ offer: o, endDate }) => `${o.id}@${endDate}`),
  });
  assert.deepEqual(ids(planOfferReplacement(existing, ["USA"], { endDate: "2026-11-30" }, today)), { remove: ["running"], end: [] });
  assert.deepEqual(ids(planOfferReplacement(existing, ["USA"], { startDate: "2026-11-01" }, today)), { remove: ["running", "december"], end: [] });
  assert.deepEqual(ids(planOfferReplacement(existing, ["USA", "CAN"], { startDate: "2026-11-20" }, today)), {
    remove: ["december"],
    end: ["running@2026-11-19", "canada@2026-11-19"],
  });
  assert.deepEqual(ids(planOfferReplacement(existing, ["USA"], { startDate: "2027-01-01" }, today)), { remove: [], end: ["running@2026-12-31"] });
  assert.deepEqual(ids(planOfferReplacement(existing, ["MEX"], {}, today)), { remove: [], end: [] });
});
