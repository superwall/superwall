import { test } from "node:test";
import assert from "node:assert/strict";
import { listAsaTools } from "@/core/apple-search-ads/tools";

async function inputOf(group: string, action: string): Promise<Record<string, unknown>> {
  const tool = (await listAsaTools()).find((t) => t.words[0] === group && t.words[1] === action);
  assert.ok(tool, `${group} ${action}`);
  return tool.input.properties;
}

async function toolOf(group: string, action: string) {
  const tool = (await listAsaTools()).find((t) => t.words[0] === group && t.words[1] === action);
  assert.ok(tool, `${group} ${action}`);
  return tool;
}

test("tool inputs are named after the CLI flags, not Apple's body keys", async () => {
  const campaign = await inputOf("campaigns", "create");
  for (const name of ["countries", "daily_budget", "supply_sources", "supply_placements", "bid_strategy", "bid_goal", "start", "end", "ad_account_id"]) {
    assert.ok(campaign[name], name);
  }
  for (const name of ["targeting", "daily_budget_value", "start_time", "org_id"]) assert.equal(campaign[name], undefined, name);
  const adgroup = await inputOf("adgroups", "create");
  for (const name of ["campaign", "pricing_model", "bid", "search_match"]) assert.ok(adgroup[name], name);
  assert.ok((await inputOf("keywords", "create")).bid);
});

test("query tools take the query, filter shorthand, scope filters and paging", async () => {
  const keywords = await inputOf("keywords", "list");
  for (const name of ["query", "field", "op", "values", "order_by", "campaign", "adgroup", "limit", "offset", "all"]) assert.ok(keywords[name], name);
  assert.equal(keywords.selector, undefined);
  const report = await toolOf("reports", "keywords");
  for (const name of ["start", "end", "granularity", "group_by", "fields", "time_zone", "campaign"]) assert.ok(report.input.properties[name], name);
  assert.deepEqual(report.input.required, ["campaign", "start", "end"]);
  assert.equal((await inputOf("insights", "impression-share")).time_zone, undefined);
  assert.deepEqual((await toolOf("product-pages", "list")).input.required, ["adam_id"]);
  assert.deepEqual((await toolOf("apps", "localized")).input.required, ["adam_id"]);
});

test("tool inputs carry the URL params, the geo source and the body each operation reads", async () => {
  const apps = await inputOf("apps", "search");
  for (const name of ["owned", "store_fronts", "limit"]) assert.ok(apps[name], name);
  const geo = await inputOf("geo", "search");
  for (const name of ["country", "entity", "supply_source", "eligible"]) assert.ok(geo[name], name);
  const geoGet = await toolOf("geo", "get");
  assert.ok(geoGet.input.properties.supply_source);
  assert.deepEqual(geoGet.input.required, ["ids", "entity"]);
  assert.ok((await inputOf("ad-accounts", "resources")).resource_type);
  assert.deepEqual((await toolOf("recommendations", "apply-target-cpas")).input.required, ["body"]);
  const update = await toolOf("keywords", "update");
  assert.ok(update.input.properties.body);
  assert.deepEqual(update.input.required, []);
  assert.deepEqual((await toolOf("campaigns", "update")).input.required, ["id"]);
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
