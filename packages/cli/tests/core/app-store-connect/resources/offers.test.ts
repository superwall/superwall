import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as offers } from "@/commands/app-store-connect/store/offers";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { EQUALIZATIONS, subscriptionView, USA_POINTS } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const OFFERS = "GET /v1/subscriptions/601/introductoryOffers?include=territory,subscriptionPricePoint&limit=200&fields[subscriptionPricePoints]=customerPrice";

test("a free trial goes to every territory the subscription is sold in, in one PATCH", async () => {
  const { api, writes } = ascRoutes({ ...subscriptionView("601"), "PATCH /v1/subscriptions/601": { data: one("subscriptions", "601") } });
  const result = await runCommand(offers, {
    api,
    words: ["create"],
    flags: { subscription: "601", offerMode: "free-trial", duration: "TWO_WEEKS", endDate: "2027-01-01" },
  });
  const offer = (territory: string) => ({
    type: "subscriptionIntroductoryOffers",
    id: `\${offer-${territory}}`,
    attributes: { offerMode: "FREE_TRIAL", duration: "TWO_WEEKS", numberOfPeriods: 1, endDate: "2027-01-01" },
    relationships: { subscription: link("subscriptions", "601"), territory: link("territories", territory) },
  });
  assert.deepEqual(writes(), [
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
  assert.deepEqual(result.said("success"), ["Created a FREE_TRIAL introductory offer in 2 territories"]);
});

test("a paid offer is priced in its territory and equalized, skipping territories Apple has no point for", async () => {
  const { api, writes } = ascRoutes({
    ...subscriptionView("601"),
    [USA_POINTS("601")]: page([one("subscriptionPricePoints", "P-USA", { customerPrice: "0.99" })]),
    [EQUALIZATIONS("P-USA")]: page([one("subscriptionPricePoints", "P-CAN", {}, { territory: link("territories", "CAN") })]),
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
    },
    json: true,
  });
  const body = writes()[0]?.body as { included: { attributes: unknown; relationships: { subscriptionPricePoint?: unknown } }[] };
  assert.deepEqual(
    body.included.map((entry) => entry.relationships.subscriptionPricePoint),
    [link("subscriptionPricePoints", "P-USA"), link("subscriptionPricePoints", "P-CAN")],
  );
  assert.deepEqual(body.included[0]?.attributes, { offerMode: "PAY_UP_FRONT", duration: "ONE_MONTH", numberOfPeriods: 1, startDate: "2026-11-01" });
  assert.deepEqual((result.json as { skippedTerritories: string[] }).skippedTerritories, ["ATA"]);
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
