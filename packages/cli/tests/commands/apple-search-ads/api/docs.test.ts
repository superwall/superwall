import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asaDocs } from "@/commands/apple-search-ads/api/docs";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asa docs renders the catalog, a group, and a search without touching the API", async () => {
  const markdown = (out: { json: unknown }) => (out.json as { markdown: string }).markdown;
  const catalog = await runCommand(asaDocs, { json: true });
  assert.match(markdown(catalog), /# Apple Search Ads/);

  const group = await runCommand(asaDocs, { args: { resource: "keywords" }, json: true });
  assert.match(markdown(group), /# asa keywords/);

  const search = await runCommand(asaDocs, { args: { resource: "budget" }, json: true });
  assert.match(markdown(search), /budget-orders/);
});

test("asa docs prints one operation's schema as markdown outside --json, through the host", async () => {
  const out = await runCommand(asaDocs, { args: { resource: "campaigns", operation: "create" } });
  assert.match(out.said("report").join("\n"), /campaigns create/);
});
