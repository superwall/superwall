import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as metadata } from "@/commands/app-store-connect/release/metadata";
import { ascRoutes, link, one, page } from "../../../helpers/asc-proxy";
import { VERSION_ID } from "../../../helpers/asc-store";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

const LOCALE = (locale: string) => `GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionLocalizations?filter[locale]=${locale}&limit=1`;
const english = one("appStoreVersionLocalizations", "L1", { locale: "en-US", whatsNew: "Faster", keywords: "cruise,price", description: "Saves money" });

test("list shows each locale and which fields it has", async () => {
  const { api } = ascRoutes({
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionLocalizations?limit=200`]: page([english, one("appStoreVersionLocalizations", "L2", { locale: "de-DE" })]),
  });
  const human = await runCommand(metadata, { api, words: ["list", VERSION_ID] });
  assert.deepEqual(human.said("info"), ["`en-US`  whatsNew, description, keywords  L1", "`de-DE`  empty  L2"]);
  const json = await runCommand(metadata, { api, words: ["list", VERSION_ID], json: true });
  assert.deepEqual(json.json, [
    { id: "L1", locale: "en-US", whatsNew: "Faster", description: "Saves money", keywords: "cruise,price" },
    { id: "L2", locale: "de-DE" },
  ]);
});

test("get reads one locale, and says how to add a missing one", async () => {
  const { api } = ascRoutes({ [LOCALE("en-US")]: page([english]), [LOCALE("fr-FR")]: page([]) });
  const found = await runCommand(metadata, { api, words: ["get", VERSION_ID], flags: { locale: "en-US" }, json: true });
  assert.deepEqual(found.json, { id: "L1", locale: "en-US", whatsNew: "Faster", description: "Saves money", keywords: "cruise,price" });
  const missing = await runCommand(metadata, { api, words: ["get", VERSION_ID], flags: { locale: "fr-FR" } });
  assert.deepEqual(missing.said("error"), [`Version ${VERSION_ID} has no fr-FR metadata. Add it with asc metadata add.`]);
});

test("update patches the locale's localization with Apple's attribute names", async () => {
  const { api, writes } = ascRoutes({ [LOCALE("en-US")]: page([english]), "PATCH /v1/appStoreVersionLocalizations/L1": { data: english } });
  const result = await runCommand(metadata, {
    api,
    words: ["update", VERSION_ID],
    flags: {
      locale: "en-US",
      whatsNew: "Bug fixes",
      description: "New",
      keywords: "a,b",
      promotionalText: "Now faster",
      supportUrl: "https://acme.com/help",
      marketingUrl: "https://acme.com",
    },
  });
  assert.deepEqual(writes(), [
    {
      method: "PATCH",
      path: "/v1/appStoreVersionLocalizations/L1",
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          id: "L1",
          attributes: {
            whatsNew: "Bug fixes",
            description: "New",
            keywords: "a,b",
            promotionalText: "Now faster",
            supportUrl: "https://acme.com/help",
            marketingUrl: "https://acme.com",
          },
        },
      },
    },
  ]);
  assert.deepEqual(result.said("success"), ["Updated the en-US metadata"]);
});

test("update with nothing to change sends nothing; a dry run still reads the locale", async () => {
  const { api, sent, writes } = ascRoutes({ [LOCALE("en-US")]: page([english]) });
  const nothing = await runCommand(metadata, { api, words: ["update", VERSION_ID], flags: { locale: "en-US" } });
  assert.deepEqual(nothing.said("error"), ["Nothing to change: pass --whats-new, --description, --keywords, --promotional-text, --support-url or --marketing-url."]);
  assert.deepEqual(sent, []);
  const planned = await runCommand(metadata, { api, words: ["update", VERSION_ID], flags: { locale: "en-US", whatsNew: "x", dryRun: true }, json: true });
  assert.deepEqual(
    (planned.json as { requests: { method: string; path: string }[] }).requests.map((request) => `${request.method} ${request.path}`),
    [LOCALE("en-US"), "PATCH /v1/appStoreVersionLocalizations/L1"],
  );
  assert.deepEqual(writes(), []);
});

test("add creates the locale on the version", async () => {
  const { api, writes } = ascRoutes({ "POST /v1/appStoreVersionLocalizations": { data: one("appStoreVersionLocalizations", "L3", { locale: "de-DE", whatsNew: "Schneller" }) } });
  const result = await runCommand(metadata, { api, words: ["add", VERSION_ID], flags: { locale: "de-DE", whatsNew: "Schneller" }, json: true });
  assert.deepEqual(writes(), [
    {
      method: "POST",
      path: "/v1/appStoreVersionLocalizations",
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: { locale: "de-DE", whatsNew: "Schneller" },
          relationships: { appStoreVersion: link("appStoreVersions", VERSION_ID) },
        },
      },
    },
  ]);
  assert.deepEqual(result.json, { id: "L3", locale: "de-DE", whatsNew: "Schneller" });
  const none = ascRoutes({ "POST /v1/appStoreVersionLocalizations": { data: null } });
  assert.deepEqual((await runCommand(metadata, { api: none.api, words: ["add", VERSION_ID], flags: { locale: "de-DE" } })).said("error"), ["Apple created no localization."]);
});
