import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as groups } from "@/commands/app-store-connect/store/subscription-groups";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { APP_BY_BUNDLE, GROUPS_OF_APP } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const VIEW = {
  "GET /v1/subscriptionGroups/201": { data: one("subscriptionGroups", "201", { referenceName: "Pro" }) },
  "GET /v1/subscriptionGroups/201/versions": page([
    one("subscriptionGroupVersions", "GV1", { version: 1, state: "APPROVED" }),
    one("subscriptionGroupVersions", "GV2", { version: 2, state: "PREPARE_FOR_SUBMISSION" }),
  ]),
  "GET /v1/subscriptionGroupVersions/GV2/localizations?limit=200": page([
    one("subscriptionGroupLocalizations", "GL1", { locale: "en-US", name: "Pro", customAppName: "Acme", state: "PREPARE_FOR_SUBMISSION" }),
  ]),
  "GET /v1/subscriptionGroups/201/subscriptions?limit=200": page([one("subscriptions", "601", { productId: "pro.monthly", name: "Monthly", state: "APPROVED" })]),
};

test("create makes the group and its localization on the version Apple made", async () => {
  const { api, writes } = ascRoutes({
    [APP_BY_BUNDLE]: page([one("apps", "555")]),
    "POST /v1/subscriptionGroups": { data: one("subscriptionGroups", "201") },
    "POST /v2/subscriptionGroupLocalizations": { data: one("subscriptionGroupLocalizations", "GL1") },
    ...VIEW,
  });
  const result = await runCommand(groups, {
    api,
    words: ["create"],
    flags: { ascApp: "com.acme.app", referenceName: "Pro", displayName: "Pro", customAppName: "Acme", locale: "de-DE" },
    json: true,
  });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/subscriptionGroups",
      body: { data: { type: "subscriptionGroups", attributes: { referenceName: "Pro" }, relationships: { app: link("apps", "555") } } },
    },
    {
      method: "POST",
      path: "/v2/subscriptionGroupLocalizations",
      body: {
        data: {
          type: "subscriptionGroupLocalizations",
          attributes: { locale: "de-DE", name: "Pro", customAppName: "Acme" },
          relationships: { version: link("subscriptionGroupVersions", "GV2") },
        },
      },
    },
  ]);
  assert.deepEqual(result.json, {
    id: "201",
    referenceName: "Pro",
    version: { id: "GV2", version: 2, state: "PREPARE_FOR_SUBMISSION" },
    localizations: [{ id: "GL1", locale: "en-US", name: "Pro", customAppName: "Acme", state: "PREPARE_FOR_SUBMISSION" }],
    subscriptions: [{ id: "601", productId: "pro.monthly", name: "Monthly", state: "APPROVED" }],
    missing: [],
  });
});

test("create without a display name makes only the group, which then misses a localization", async () => {
  const { api, writes } = ascRoutes({
    "POST /v1/subscriptionGroups": { data: one("subscriptionGroups", "202") },
    "GET /v1/subscriptionGroups/202": { data: one("subscriptionGroups", "202", { referenceName: "Basic" }) },
    "GET /v1/subscriptionGroups/202/versions": page([]),
    "GET /v1/subscriptionGroups/202/subscriptions?limit=200": page([]),
  });
  const human = await runCommand(groups, { api, words: ["create"], flags: { ascApp: "555", referenceName: "Basic" } });
  assert.equal(writes().length, 1);
  assert.deepEqual(human.said("success"), ["Created the subscription group Basic"]);
});

test("create stops when Apple returns no group, or no version to localize", async () => {
  const flags = { ascApp: "555", referenceName: "Pro", displayName: "Pro" };
  const none = ascRoutes({ "POST /v1/subscriptionGroups": {} });
  assert.deepEqual((await runCommand(groups, { api: none.api, words: ["create"], flags })).said("error"), ["Apple created no subscription group."]);
  const noVersion = ascRoutes({ "POST /v1/subscriptionGroups": { data: one("subscriptionGroups", "201") }, "GET /v1/subscriptionGroups/201/versions": page([]) });
  assert.deepEqual((await runCommand(groups, { api: noVersion.api, words: ["create"], flags })).said("error"), [
    "Apple made no version of subscription group 201 to localize.",
  ]);
});

test("list, get, update and delete", async () => {
  const { api, writes } = ascRoutes({
    [GROUPS_OF_APP]: page([one("subscriptionGroups", "201", { referenceName: "Pro" }), one("subscriptionGroups", "202")]),
    "PATCH /v1/subscriptionGroups/201": { data: one("subscriptionGroups", "201", { referenceName: "Premium" }) },
    "DELETE /v1/subscriptionGroups/201": undefined,
    "GET /v1/subscriptionGroups/209": { data: null },
    ...VIEW,
  });
  const list = await runCommand(groups, { api, words: ["list", "555"] });
  assert.deepEqual(list.said("info"), ["`Pro`  201", "`202`  202"]);
  const shown = await runCommand(groups, { api, words: ["201"], json: true });
  assert.equal((shown.json as { referenceName: string }).referenceName, "Pro");
  const missing = await runCommand(groups, { api, words: ["get", "209"] });
  assert.deepEqual(missing.said("error"), ["No subscription group 209."]);
  const renamed = await runCommand(groups, { api, words: ["update", "201"], flags: { referenceName: "Premium" }, json: true });
  assert.deepEqual(renamed.json, { id: "201", referenceName: "Premium" });
  const deleted = await runCommand(groups, { api, words: ["delete", "201"], flags: { yes: true }, json: true });
  assert.deepEqual(deleted.json, { id: "201", deleted: true });
  assert.deepEqual(writes(), [
    { method: "PATCH", path: "/v1/subscriptionGroups/201", body: { data: { type: "subscriptionGroups", id: "201", attributes: { referenceName: "Premium" } } } },
    { method: "DELETE", path: "/v1/subscriptionGroups/201" },
  ]);
});

test("an empty patch answer still reports the new name", async () => {
  const { api } = ascRoutes({ "PATCH /v1/subscriptionGroups/201": undefined });
  const renamed = await runCommand(groups, { api, words: ["update", "201"], flags: { referenceName: "Premium" }, json: true });
  assert.deepEqual(renamed.json, { id: "201", referenceName: "Premium" });
});
