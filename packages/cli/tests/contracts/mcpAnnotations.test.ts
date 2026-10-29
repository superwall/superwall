import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import expected from "../fixtures/mcp-annotations.json";
import { memoryStore } from "@/core/state/store";
import { listTools, useToolCache, type Tool } from "@/tools";

const cache = memoryStore();
cache.write("api-index.json", JSON.stringify({ version: "test", fetchedAt: Date.now(), operations: [] }));
useToolCache(cache);
const tools = await listTools();
const tool = (name: string): Tool => {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found, name);
  return found;
};

function assertHints(actual: { name: string; annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } }[], fixture: Record<string, object>): void {
  assert.deepEqual(actual.map((entry) => entry.name).sort(), Object.keys(fixture).sort());
  for (const entry of actual) {
    const { title, ...hints } = entry.annotations;
    assert.equal(typeof title, "string", entry.name);
    assert.equal(Object.keys(hints).length, 4, entry.name);
    for (const [name, value] of Object.entries(hints)) assert.equal(typeof value, "boolean", `${entry.name}.${name}`);
    assert.deepEqual(hints, fixture[entry.name], entry.name);
  }
}

test("every exposed operation matches the independently reviewed boolean expectations", () => {
  const fixture = Object.fromEntries(Object.entries(expected).filter(([name]) => name !== "skill"));
  assertHints(tools, fixture);
});

test("the self-contained published bundle preserves the full catalog and all four explicit hints", () => {
  const url = new URL("../../dist/tools.js", import.meta.url).href;
  const script = `import { listTools } from ${JSON.stringify(url)}; console.log(JSON.stringify((await listTools()).map(({name, annotations}) => ({name, annotations}))));`;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", maxBuffer: 1024 * 1024, env: { ...process.env, NODE_V8_COVERAGE: undefined, NODE_TEST_CONTEXT: undefined } });
  assertHints(JSON.parse(output), expected);
});

test("overwrites, rollout transitions, delivery and replacement branches require destructive hints", () => {
  for (const name of [
    "apps_update", "entitlements_update", "campaigns_prioritize", "campaigns_audiences_reorder",
    "campaigns_variants_create", "campaigns_variants_weights", "users_update", "webhooks_update",
    "asc_keys_import", "asc_notification_url_set", "asc_prices_set", "asc_availability_set",
    "asc_offers_create", "asc_release_submit", "asc_release_phased", "feedback", "events_retry", "annotations_update",
  ]) {
    assert.equal(tool(name).annotations.readOnlyHint, false, name);
    assert.equal(tool(name).annotations.destructiveHint, true, name);
    assert.equal(tool(name).annotations.idempotentHint, false, name);
  }
  assert.match(tool("campaigns_variants_create").description, /100%.*zeroes.*holdout/);
  assert.match(tool("events_retry").description, /duplicate downstream/);
  assert.match(tool("feedback").description, /cannot be undone/);
  assert.match(tool("asc_release_phased").description, /all users/);
});

test("POST lookups are reads while report jobs persist state", () => {
  for (const name of ["asa_ad_rejections_assets", "asa_apps_eligibility", "asa_geo_get", "asa_reports_campaigns"]) {
    assert.equal(tool(name).annotations.readOnlyHint, true, name);
    assert.equal(tool(name).annotations.destructiveHint, false, name);
    assert.equal(tool(name).annotations.idempotentHint, true, name);
  }
  assert.equal(tool("asa_impression_share_create").annotations.readOnlyHint, false);
  assert.equal(tool("asa_impression_share_create").annotations.destructiveHint, false);
});

test("generic execution covers destructive branches and arbitrary webhook destinations", () => {
  for (const name of ["post", "patch", "asc_post", "asc_patch", "asa_post", "asa_put", "asa_keywords_delete", "asa_negative_keywords_delete"]) {
    assert.equal(tool(name).annotations.destructiveHint, true, name);
  }
  assert.equal(tool("post").annotations.openWorldHint, true);
  assert.equal(tool("patch").annotations.openWorldHint, true);
  assert.match(tool("asa_post").description, /bulk-delete/);
  assert.match(tool("post").description, /caller-supplied HTTPS/);
});

test("creation effects distinguish advertising spend, paused duplicates and additive grants", () => {
  for (const name of ["asa_campaigns_create", "asa_adgroups_create", "asa_keywords_create", "asa_ads_create", "asa_budget_orders_create"]) {
    assert.equal(tool(name).annotations.destructiveHint, true, name);
  }
  assert.equal(tool("campaigns_audiences_create").annotations.destructiveHint, false);
  assert.match(tool("campaigns_audiences_create").description, /Appends.*precedence is preserved/);
  assert.equal(tool("campaigns_audiences_duplicate").annotations.destructiveHint, true);
  assert.match(tool("campaigns_audiences_duplicate").description, /paused.*rewrite/);
  assert.equal(tool("entitlements_grants_create").annotations.destructiveHint, false);
  assert.match(tool("entitlements_grants_create").description, /active grant already exists/);
});

test("SQL read-only mode does not hide credential provisioning and access-policy reconciliation", () => {
  for (const name of ["query", "get"]) {
    assert.equal(tool(name).annotations.readOnlyHint, false, name);
    assert.equal(tool(name).annotations.destructiveHint, true, name);
    assert.equal(tool(name).annotations.idempotentHint, false, name);
    assert.match(tool(name).description, /provision.*credentials|provision.*ClickHouse/);
  }
});
