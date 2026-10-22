import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as metadata } from "@/commands/app-store-connect/release/metadata";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { VERSION_ID } from "../../../helpers/asc-store";
import { helpLine, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc metadata update takes Apple's field names as flags, through the parser", async () => {
  const { api, writes } = ascRoutes({
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionLocalizations?filter[locale]=en-US&limit=1`]: page([one("appStoreVersionLocalizations", "L1")]),
    "PATCH /v1/appStoreVersionLocalizations/L1": undefined,
  });
  await runLine(`asc metadata update ${VERSION_ID} --locale en-US --promotional-text Now --support-url https://acme.com`, { api });
  assert.deepEqual(writes()[0]?.body, {
    data: { type: "appStoreVersionLocalizations", id: "L1", attributes: { promotionalText: "Now", supportUrl: "https://acme.com" } },
  });
});

test("asc metadata help names every field, and needs --locale", async () => {
  const update = await helpLine("asc metadata update --help");
  for (const flag of ["--whats-new", "--description", "--keywords", "--promotional-text", "--support-url", "--marketing-url"]) assert.match(update, new RegExp(flag));
  const tools = await metadata.tools();
  assert.deepEqual(tools.find((tool) => tool.words[0] === "add")?.input.required, ["version", "locale"]);
});
