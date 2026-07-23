import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { executeCommand } from "@/command";
import { runQuery } from "@/commands/query";
import { recordingRenderer } from "../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

test("query --json reparses ClickHouse output through the shared two-space serializer", async () => {
  const response = '{"meta":[{"name":"ok","type":"UInt8"}],"data":[{"ok":1}],"rows":1}';
  const api = {
    org: { id: "42" },
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
  const api = { org: { id: "42" } } as unknown as SuperwallApi;
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
