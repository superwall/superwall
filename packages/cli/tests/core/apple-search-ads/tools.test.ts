import { test } from "node:test";
import assert from "node:assert/strict";
import { listAsaTools } from "@/core/apple-search-ads/tools";

async function inputOf(group: string, action: string): Promise<Record<string, unknown>> {
  const tool = (await listAsaTools()).find((t) => t.words[0] === group && t.words[1] === action);
  assert.ok(tool, `${group} ${action}`);
  return tool.input.properties;
}

test("tool inputs are named after the CLI flags, not Apple's body keys", async () => {
  const campaign = await inputOf("campaigns", "create");
  for (const name of ["countries", "budget", "daily_budget", "supply_sources", "start", "end"]) assert.ok(campaign[name], name);
  for (const name of ["countries_or_regions", "budget_amount", "daily_budget_amount", "start_time"]) assert.equal(campaign[name], undefined, name);
  const adgroup = await inputOf("adgroups", "create");
  for (const name of ["default_bid", "cpa_goal", "search_match"]) assert.ok(adgroup[name], name);
  assert.ok((await inputOf("keywords", "create")).bid);
});

test("tool inputs carry the query flags each operation reads", async () => {
  assert.ok((await inputOf("campaigns", "get")).fields);
  const find = await inputOf("campaigns", "find");
  for (const name of ["field", "op", "values", "order_by", "fields"]) assert.ok(find[name], name);
  const pages = await inputOf("product-pages", "list");
  for (const name of ["name", "states"]) assert.ok(pages[name], name);
  const locales = await inputOf("product-pages", "locales");
  for (const name of ["device_classes", "language_codes", "expand"]) assert.ok(locales[name], name);
  assert.ok((await inputOf("product-pages", "countries")).countries);
  assert.ok((await inputOf("creatives", "get")).include_deleted_assets);
  assert.ok((await inputOf("apps", "search")).owned);
  assert.ok((await inputOf("geo", "search")).country);
});

test("a combined tool accounts for every reachable endpoint variant", async () => {
  const { ASA_OPERATIONS } = await import("@/core/apple-search-ads/catalog");
  const first = ASA_OPERATIONS.find((operation) => operation.group === "campaigns" && operation.action === "get");
  assert.ok(first);
  ASA_OPERATIONS.push({ ...first, path: "/other/{id}", effect: "destructive" });
  try {
    assert.equal((await listAsaTools()).find((tool) => tool.words.join(" ") === "campaigns get")?.effect, "destructive");
  } finally {
    ASA_OPERATIONS.pop();
  }
  ASA_OPERATIONS.push({ ...first, path: "/other/{id}", effect: "write" });
  try {
    assert.equal((await listAsaTools()).find((tool) => tool.words.join(" ") === "campaigns get")?.effect, "write");
  } finally {
    ASA_OPERATIONS.pop();
  }
});
