import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as localizations } from "@/commands/app-store-connect/store/localizations";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const APPROVED = { "GET /v1/subscriptions/601/versions": page([one("subscriptionVersions", "V1", { version: 1, state: "APPROVED" })]) };
const DRAFT = { "GET /v2/inAppPurchases/701/versions": page([one("inAppPurchaseVersions", "IV2", { version: 2, state: "REJECTED" })]) };

test("list reads the localizations of the latest version of a subscription, group or in-app purchase", async () => {
  const { api } = ascRoutes({
    ...APPROVED,
    "GET /v1/subscriptionVersions/V1/localizations?limit=200": page([one("subscriptionLocalizations", "L1", { locale: "en-US", name: "Pro", state: "APPROVED" })]),
    "GET /v1/subscriptionGroups/201/versions": page([]),
  });
  const sub = await runCommand(localizations, { api, words: ["list"], flags: { subscription: "601" } });
  assert.deepEqual(sub.said("info"), ["`en-US`  Pro  APPROVED  L1"]);
  const group = await runCommand(localizations, { api, words: ["list"], flags: { group: "201" }, json: true });
  assert.deepEqual(group.json, []);
});

test("add goes to the editable version, or to a new version of an approved product", async () => {
  const { api, writes } = ascRoutes({
    ...APPROVED,
    ...DRAFT,
    "POST /v1/subscriptionVersions": { data: one("subscriptionVersions", "V2") },
    "POST /v2/subscriptionLocalizations": { data: one("subscriptionLocalizations", "L2", { locale: "de-DE", name: "Pro" }) },
    "POST /v2/inAppPurchaseLocalizations": { data: one("inAppPurchaseLocalizations", "IL2") },
  });
  const added = await runCommand(localizations, { api, words: ["add"], flags: { subscription: "601", locale: "de-DE", name: "Pro", description: "Alles" }, json: true });
  assert.deepEqual(added.json, { id: "L2", locale: "de-DE", name: "Pro" });
  await runCommand(localizations, { api, words: ["add"], flags: { iap: "701", locale: "fr-FR", name: "Pièces" } });
  assert.deepEqual(writes(), [
    { method: "POST", path: "/v1/subscriptionVersions", body: { data: { type: "subscriptionVersions", relationships: { subscription: link("subscriptions", "601") } } } },
    {
      method: "POST",
      path: "/v2/subscriptionLocalizations",
      body: {
        data: {
          type: "subscriptionLocalizations",
          attributes: { locale: "de-DE", name: "Pro", description: "Alles" },
          relationships: { version: link("subscriptionVersions", "V2") },
        },
      },
    },
    {
      method: "POST",
      path: "/v2/inAppPurchaseLocalizations",
      body: {
        data: { type: "inAppPurchaseLocalizations", attributes: { locale: "fr-FR", name: "Pièces" }, relationships: { version: link("inAppPurchaseVersions", "IV2") } },
      },
    },
  ]);
});

test("add refuses fields the kind of product has no place for, before sending anything", async () => {
  const { api, sent } = ascRoutes({});
  const group = await runCommand(localizations, { api, words: ["add"], flags: { group: "201", locale: "en-US", name: "Pro", description: "x" } });
  assert.deepEqual(group.said("error"), ["A subscription group's localization has no --description; it takes --custom-app-name."]);
  const sub = await runCommand(localizations, { api, words: ["add"], flags: { subscription: "601", locale: "en-US", name: "Pro", customAppName: "x" } });
  assert.deepEqual(sub.said("error"), ["Only a subscription group's localization takes --custom-app-name."]);
  assert.deepEqual(sent, []);
});

test("a product Apple made no new version for can't take a localization", async () => {
  const { api } = ascRoutes({ ...APPROVED, "POST /v1/subscriptionVersions": {} });
  const result = await runCommand(localizations, { api, words: ["add"], flags: { subscription: "601", locale: "de-DE", name: "Pro" } });
  assert.deepEqual(result.said("error"), ["Apple created no new version of subscription 601."]);
});

test("update finds the locale on the editable version and patches it", async () => {
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptionGroups/201/versions": page([one("subscriptionGroupVersions", "GV1", { version: 1, state: "PREPARE_FOR_SUBMISSION" })]),
    "GET /v1/subscriptionGroupVersions/GV1/localizations?limit=200": page([one("subscriptionGroupLocalizations", "GL1", { locale: "en-US" })]),
    "PATCH /v2/subscriptionGroupLocalizations/GL1": { data: one("subscriptionGroupLocalizations", "GL1", { locale: "en-US", customAppName: "Acme+" }) },
  });
  const updated = await runCommand(localizations, { api, words: ["update"], flags: { group: "201", locale: "en-US", customAppName: "Acme+" }, json: true });
  assert.deepEqual(updated.json, { id: "GL1", locale: "en-US", customAppName: "Acme+" });
  assert.deepEqual(writes(), [
    {
      method: "PATCH",
      path: "/v2/subscriptionGroupLocalizations/GL1",
      body: { data: { type: "subscriptionGroupLocalizations", id: "GL1", attributes: { customAppName: "Acme+" } } },
    },
  ]);
  const unknown = await runCommand(localizations, { api, words: ["update"], flags: { group: "201", locale: "ja", name: "x" } });
  assert.deepEqual(unknown.said("error"), ["The subscription group 201 has no ja localization. Add one with superwall asc localizations add."]);
  const nothing = await runCommand(localizations, { api, words: ["update"], flags: { group: "201", locale: "en-US" } });
  assert.deepEqual(nothing.said("error"), ["Nothing to change: pass --name, --description or --custom-app-name."]);
});

test("a dry-run update of an approved product plans its new version, then the patch", async () => {
  const { api, writes } = ascRoutes(APPROVED);
  const result = await runCommand(localizations, { api, words: ["update"], flags: { subscription: "601", locale: "en-US", name: "Pro", dryRun: true }, json: true });
  assert.deepEqual(writes(), []);
  assert.deepEqual(
    (result.json as { requests: { method: string; path: string }[] }).requests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /v1/subscriptions/601/versions",
      "POST /v1/subscriptionVersions",
      "GET /v1/subscriptionVersions/${version}/localizations?limit=200",
      "PATCH /v2/subscriptionLocalizations/${localization}",
    ],
  );
});

test("delete confirms, then deletes the locale's localization", async () => {
  const { api, writes } = ascRoutes({
    ...DRAFT,
    "GET /v1/inAppPurchaseVersions/IV2/localizations?limit=200": page([one("inAppPurchaseLocalizations", "IL1", { locale: "en-US" })]),
    "DELETE /v2/inAppPurchaseLocalizations/IL1": undefined,
  });
  const refused = await runCommand(localizations, { api, words: ["delete"], flags: { iap: "701", locale: "en-US" } });
  assert.match(refused.said("error")[0] ?? "", /^Delete the en-US localization of in-app purchase 701/);
  const deleted = await runCommand(localizations, { api, words: ["delete"], flags: { iap: "701", locale: "en-US", yes: true }, json: true });
  assert.deepEqual(deleted.json, { id: "IL1", locale: "en-US", deleted: true });
  assert.deepEqual(writes(), [{ method: "DELETE", path: "/v2/inAppPurchaseLocalizations/IL1" }]);
});

test("exactly one of --subscription, --group or --iap", async () => {
  const { api } = ascRoutes({});
  const none = await runCommand(localizations, { api, words: ["list"] });
  assert.deepEqual(none.said("error"), ["Pass one of --subscription, --group, or --iap."]);
  const two = await runCommand(localizations, { api, words: ["list"], flags: { subscription: "1", iap: "2" } });
  assert.deepEqual(two.said("error"), ["Pass one of --subscription, --group, or --iap."]);
});
