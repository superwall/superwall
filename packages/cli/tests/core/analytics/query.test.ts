import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { command as query } from "@/commands/analytics/query";
import { runCommand } from "../../helpers/command";
import { clearHomes, useHome } from "../../helpers/home";

const dirs: string[] = [];

afterEach(() => {
  clearHomes();
  process.exitCode = undefined;
});

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const projects = [
  { id: 1, organization_id: "42", applications: [{ id: 10, name: "Mine", platform: "ios" }] },
  { id: 2, organization_id: "7", applications: [{ id: 20, name: "Theirs", platform: "ios" }] },
];

function fakeApi(options: { overview?: () => unknown; output?: string; projects?: () => unknown[] } = {}) {
  const sent: { path: string; sql: string }[] = [];
  const api = {
    list: async () => (options.projects ? options.projects() : projects),
    get: async (path: string) => {
      if (path.endsWith("/integrations/overview")) return options.overview ? options.overview() : {};
      return { name: "Org" };
    },
    postText: async (path: string, sql: string) => {
      sent.push({ path, sql });
      return options.output ?? "1\t2\n";
    },
  } as unknown as SuperwallApi;
  return { api, sent };
}

async function errorOf(run: Promise<{ stdout: string }>): Promise<string> {
  return JSON.parse((await run).stdout).error.message;
}

test("query prints ClickHouse text for one organization, sending only the SQL", async () => {
  useHome();
  const { api, sent } = fakeApi({ projects: () => [projects[0]] });
  const result = await runCommand(query, { args: { sql: "  SELECT 1, 2  " }, api });
  assert.deepEqual(sent, [{ path: "/v2/organizations/42/query", sql: "SELECT 1, 2" }]);
  assert.deepEqual(result.said("intro"), ["Superwall query"]);
  assert.deepEqual(result.said("report"), ["1\t2"]);
});

test("query --app says which revenue provider the app counts", async () => {
  useHome();
  const { api, sent } = fakeApi({ overview: () => ({ revenue_provider: "revenue_cat" }) });
  const result = await runCommand(query, {
    args: { sql: "SELECT 1" },
    flags: { app: "20", param: ["from=2026-10-01", "note=a=b"] },
    api,
  });
  assert.deepEqual(result.said("info"), [
    "`Theirs` counts revenue from revenue_cat: {revenue_integrations} is revenue_cat, stripe",
  ]);
  const [path, search] = (sent[0]?.path ?? "").split("?");
  assert.equal(path, "/v2/organizations/7/query");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(search)), {
    param_from: "2026-10-01",
    param_note: "a=b",
    param_app: "20",
    param_revenue_provider: "revenue_cat",
    param_revenue_integrations: "['revenue_cat','stripe']",
  });
});

test("query --app on an app with no revenue provider says every source counts", async () => {
  useHome();
  const { api } = fakeApi();
  const result = await runCommand(query, { args: { sql: "SELECT 1" }, flags: { app: "20" }, api });
  assert.deepEqual(result.said("info"), [
    "`Theirs` has no revenue provider, so every source counts: {revenue_integrations} is app_store_connect, google_play, stripe, revenue_cat",
  ]);
});

test("query --app reports a non-Error failure reading the revenue provider", async () => {
  useHome();
  const { api, sent } = fakeApi({
    overview: () => {
      throw "gateway timeout";
    },
  });
  const message = await errorOf(runCommand(query, { args: { sql: "SELECT 1" }, flags: { app: "20" }, json: true, api }));
  assert.equal(
    message,
    "Couldn't read the revenue provider of `Theirs`, so revenue can't be counted the way the dashboard does: gateway timeout",
  );
  assert.deepEqual(sent, []);
});

test("query --app stops when the app is gone by the time its parameters are read", async () => {
  useHome();
  let calls = 0;
  const { api, sent } = fakeApi({ projects: () => (calls++ === 0 ? projects : []) });
  const message = await errorOf(runCommand(query, { args: { sql: "SELECT 1" }, flags: { app: "20" }, json: true, api }));
  assert.match(message, /^No app 20 that this account can open\./);
  assert.deepEqual(sent, []);
});

test("query reads SQL from --file", async () => {
  useHome();
  const dir = mkdtempSync(join(tmpdir(), "superwall-query-"));
  dirs.push(dir);
  const file = join(dir, "revenue.sql");
  writeFileSync(file, "SELECT sum(price)\nFROM events\n");
  const { api, sent } = fakeApi({ projects: () => [projects[0]] });
  await runCommand(query, { flags: { file }, api });
  assert.equal(sent[0]?.sql, "SELECT sum(price)\nFROM events");
});

test("query refuses SQL given twice, or none at all", async () => {
  useHome();
  const { api, sent } = fakeApi();
  assert.equal(
    await errorOf(runCommand(query, { args: { sql: "SELECT 1" }, flags: { file: "q.sql" }, json: true, api })),
    "Pass SQL as an argument, with --file, or on stdin - choose one.",
  );
  const tty = process.stdin.isTTY;
  process.stdin.isTTY = true;
  try {
    assert.equal(
      await errorOf(runCommand(query, { json: true, api })),
      'Provide SQL: superwall query "SELECT ...", --file <query.sql>, or stdin.',
    );
  } finally {
    process.stdin.isTTY = tty;
  }
  assert.deepEqual(sent, []);
});

test("query refuses a --param without a name", async () => {
  useHome();
  const { api, sent } = fakeApi({ projects: () => [projects[0]] });
  for (const param of ["from", "=2026-10-01"]) {
    assert.equal(
      await errorOf(runCommand(query, { args: { sql: "SELECT 1" }, flags: { param: [param] }, json: true, api })),
      `Invalid --param "${param}" - expected name=value.`,
    );
  }
  assert.deepEqual(sent, []);
});

test("query --json refuses output that isn't JSON", async () => {
  useHome();
  const { api } = fakeApi({ projects: () => [projects[0]], output: "1\t2\n" });
  assert.equal(
    await errorOf(runCommand(query, { args: { sql: "SELECT 1" }, json: true, api })),
    "ClickHouse did not return valid JSON. Remove any FORMAT clause and try again.",
  );
});

test("query --json asks ClickHouse for JSON and writes it as data", async () => {
  useHome();
  const { api, sent } = fakeApi({ projects: () => [projects[0]], output: '{"data":[{"n":1}],"rows":1}' });
  const result = await runCommand(query, { args: { sql: "SELECT 1 AS n" }, json: true, api });
  assert.deepEqual(sent, [{ path: "/v2/organizations/42/query?default_format=JSON", sql: "SELECT 1 AS n" }]);
  assert.deepEqual(result.json, { data: [{ n: 1 }], rows: 1 });
});

test("query --json refuses a FORMAT clause before any request", async () => {
  useHome();
  const { api, sent } = fakeApi();
  assert.equal(
    await errorOf(runCommand(query, { args: { sql: "SELECT 1 format TSV;" }, json: true, api })),
    "Remove the FORMAT clause when using --json; the CLI requests ClickHouse JSON for you.",
  );
  assert.deepEqual(sent, []);
});

test("query --app names an app without a name by its id", async () => {
  useHome();
  const { api } = fakeApi({
    projects: () => [{ id: 3, organization_id: "9", applications: [{ id: 30, platform: "ios" }] }],
    overview: () => ({ revenue_provider: "open_revenue" }),
  });
  const result = await runCommand(query, { args: { sql: "SELECT 1" }, flags: { app: "30" }, api });
  assert.deepEqual(result.said("info"), [
    "`30` counts revenue from open_revenue: {revenue_integrations} is app_store_connect, google_play, stripe",
  ]);
});
