import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { executeCommand } from "@/command";
import { runQuery } from "@/commands/platform/query";
import { recordingRenderer } from "../../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

test("query --json reparses ClickHouse output through the shared two-space serializer", async () => {
  const response = '{"meta":[{"name":"ok","type":"UInt8"}],"data":[{"ok":1}],"rows":1}';
  const api = {
    list: async () => [{ id: 1, organization_id: "42", applications: [] }],
    postText: async (path: string, sql: string) => {
      assert.equal(path, "/v2/organizations/42/query?default_format=JSON");
      assert.equal(sql, "SELECT 1 AS ok");
      return response;
    },
  } as unknown as SuperwallApi;
  let stdout = "";

  await executeCommand(
    runQuery.definition,
    { _: [], $0: "superwall", sql: "SELECT 1 AS ok", json: true },
    {
      api: () => api,
      nonInteractive: false,
      renderer: () => recordingRenderer(),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );

  assert.equal(
    stdout,
    '{\n  "meta": [\n    {\n      "name": "ok",\n      "type": "UInt8"\n    }\n  ],\n  "data": [\n    {\n      "ok": 1\n    }\n  ],\n  "rows": 1\n}\n',
  );
});

test("query --json rejects explicit FORMAT clauses as structured errors", async () => {
  const api = {} as unknown as SuperwallApi;
  let stdout = "";

  await executeCommand(
    runQuery.definition,
    { _: [], $0: "superwall", sql: "SELECT 1 FORMAT CSV", json: true },
    {
      api: () => api,
      renderer: () => recordingRenderer(),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );

  assert.match(JSON.parse(stdout).error.message, /Remove the FORMAT clause/);
  assert.equal(process.exitCode, 1);
});

const spanning = [
  { id: 1, organization_id: "42", applications: [{ id: 10, name: "Mine", platform: "ios" }] },
  { id: 2, organization_id: "7", applications: [{ id: 20, name: "Theirs", platform: "ios" }] },
];

async function queryWith(argv: Record<string, unknown>, paths: string[]): Promise<string> {
  const api = {
    list: async () => spanning,
    get: async (path: string) =>
      path === "/v2/me/organizations"
        ? { data: [{ id: "42", name: "Mine" }] }
        : { name: "Theirs Inc" },
    postText: async (path: string) => {
      paths.push(path);
      return '{"data":[]}';
    },
  } as unknown as SuperwallApi;
  let stdout = "";
  await executeCommand(
    runQuery.definition,
    { _: [], $0: "superwall", sql: "SELECT 1", json: true, ...argv },
    {
      api: () => api,
      nonInteractive: true,
      renderer: () => recordingRenderer(),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );
  return stdout;
}

test("query over apps in several organizations asks which app, without naming an org", async () => {
  const paths: string[] = [];
  const out = await queryWith({}, paths);
  const message = JSON.parse(out).error.message as string;
  assert.match(
    message,
    /Your apps are in 2 organizations - pass --app <id\|dashboard link> to say whose:/,
  );
  assert.match(message, /\n  Mine  e\.g\. --app 10\n  Theirs Inc  e\.g\. --app 20$/);
  assert.deepEqual(paths, []);
});

test("query --app reads the data of that app's organization", async () => {
  const paths: string[] = [];
  await queryWith({ app: "20" }, paths);
  assert.deepEqual(paths, ["/v2/organizations/7/query?default_format=JSON"]);
});

test("query --project reads the data of that project's organization", async () => {
  const paths: string[] = [];
  await queryWith({ project: "2" }, paths);
  assert.deepEqual(paths, ["/v2/organizations/7/query?default_format=JSON"]);
});

test("query inside a project folder reads the organization of the app in superwall.lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sw-query-"));
  writeFileSync(join(dir, "superwall.lock"), JSON.stringify({ apps: { ios: "20" }, paywalls: {} }));
  const paths: string[] = [];
  await queryWith({ installDir: dir }, paths);
  assert.deepEqual(paths, ["/v2/organizations/7/query?default_format=JSON"]);
});

test("query with every app in one organization needs no --app, however many projects", async () => {
  const paths: string[] = [];
  const api = {
    list: async () => [
      { id: 1, organization_id: "42", applications: [] },
      { id: 2, organization_id: "42", applications: [] },
      { id: 3, organization_id: "42", applications: [] },
    ],
    postText: async (path: string) => {
      paths.push(path);
      return '{"data":[]}';
    },
  } as unknown as SuperwallApi;
  await executeCommand(
    runQuery.definition,
    { _: [], $0: "superwall", sql: "SELECT 1", json: true },
    {
      api: () => api,
      nonInteractive: true,
      renderer: () => recordingRenderer(),
      stdout: { write: () => true },
      waitForPaint: false,
    },
  );
  assert.deepEqual(paths, ["/v2/organizations/42/query?default_format=JSON"]);
});

test("query on an account with no projects says how to start", async () => {
  let stdout = "";
  const api = { list: async () => [] } as unknown as SuperwallApi;
  await executeCommand(
    runQuery.definition,
    { _: [], $0: "superwall", sql: "SELECT 1", json: true },
    {
      api: () => api,
      nonInteractive: true,
      renderer: () => recordingRenderer(),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );
  assert.match(JSON.parse(stdout).error.message, /superwall apps create/);
});
