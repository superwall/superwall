import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { memoryStore } from "@/core/state/store";
import { listTools, useToolCache } from "@/tools";

interface Case {
  input: Record<string, unknown>;
  ok?: boolean;
  dryRun?: boolean;
}

useToolCache(memoryStore());
const tools = (await listTools()).filter((tool) => tool.name.startsWith("asa"));
const cases: Record<string, Case[]> = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/mcp-parity/apple-search-ads.json"), "utf8"),
);

test("every Apple Search Ads tool has parity cases, and no case names a tool that is gone", () => {
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names.filter((name) => !cases[name]?.length), []);
  assert.deepEqual(Object.keys(cases).filter((name) => !names.includes(name)), []);
});

test("each parity case only passes inputs its tool takes and turns into a CLI command", () => {
  for (const tool of tools) {
    const properties = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
    for (const { input } of cases[tool.name] ?? []) {
      const unknown = Object.keys(input).filter((key) => !properties.includes(key));
      assert.deepEqual(unknown, [], `${tool.name} ${JSON.stringify(input)}`);
      const argv = tool.cli(input);
      assert.ok(argv.length > 0, tool.name);
      assert.ok(!argv.includes("--org-id") && !argv.includes("--selector"), `${tool.name} ${argv.join(" ")}`);
    }
  }
});

test("parity writes only reach ids that can't exist or inputs the CLI refuses", () => {
  for (const tool of tools) {
    if (tool.annotations?.readOnlyHint === true) continue;
    for (const entry of cases[tool.name] ?? []) {
      if (tool.name === "asa_post" && entry.input.path === "/campaigns/query") continue;
      assert.equal(entry.ok, false, `${tool.name} ${JSON.stringify(entry.input)} must be expected to fail`);
    }
  }
});

test("v5 selector cases became v1 queries and raw requests use v1 paths", () => {
  const list = cases.asa_campaigns_list ?? [];
  assert.ok(list.some(({ input }) => typeof input.query === "object" && JSON.stringify(input.query).includes('"filters"')));
  assert.ok(!JSON.stringify(cases).includes('"conditions"'));
  const paths = (cases.asa_get ?? []).map(({ input }) => input.path);
  assert.ok(paths.includes("/acls") && paths.includes("/api/v5/me"));
});
