import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { executeCommand } from "@/command";
import { runResource } from "@/commands/resource";
import type { SuperwallApi } from "@/core/api/client";
import { recordingRenderer } from "../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

function runtime(api: SuperwallApi, write: (value: string) => void) {
  return {
    api: () => api,
    nonInteractive: false,
    renderer: () => recordingRenderer(),
    stdout: {
      write: (value: unknown) => {
        write(String(value));
        return true;
      },
    },
    waitForPaint: false,
  };
}

test("machine resource commands require explicit project scope when ambiguous", async () => {
  const api = {
    list: async (path: string) => {
      assert.equal(path, "/v2/projects");
      return [
        { id: 1, name: "One" },
        { id: 2, name: "Two" },
      ];
    },
  } as unknown as SuperwallApi;
  let stdout = "";

  await executeCommand(
    runResource("products").definition,
    { _: [], $0: "superwall", action: "list", json: true },
    runtime(api, (value) => {
      stdout += value;
    }),
  );

  assert.match(JSON.parse(stdout).error.message, /Pass --project <id>/);
  assert.equal(process.exitCode, 1);
});

test("explicit machine scope returns only the requested resource JSON", async () => {
  const paths: string[] = [];
  const api = {
    list: async (path: string) => {
      paths.push(path);
      if (path === "/v2/projects")
        return [
          { id: 1, name: "One" },
          { id: 2, name: "Two" },
        ];
      return [{ id: "product-2", identifier: "pro_yearly" }];
    },
  } as unknown as SuperwallApi;
  let stdout = "";

  await executeCommand(
    runResource("products").definition,
    { _: [], $0: "superwall", action: "list", project: "2", json: true },
    runtime(api, (value) => {
      stdout += value;
    }),
  );

  assert.deepEqual(paths, ["/v2/projects", "/v2/products?project_id=2"]);
  assert.deepEqual(JSON.parse(stdout), [{ id: "product-2", identifier: "pro_yearly" }]);
});

test("machine app-scoped commands require --app when a project has several apps", async () => {
  const api = {
    list: async () => [{ id: 1, name: "One", applications: [{ id: 10 }, { id: 11 }] }],
  } as unknown as SuperwallApi;
  let stdout = "";

  await executeCommand(
    runResource("campaigns").definition,
    { _: [], $0: "superwall", action: "list", json: true },
    runtime(api, (value) => {
      stdout += value;
    }),
  );

  assert.match(JSON.parse(stdout).error.message, /Pass --app <id>/);
  assert.equal(process.exitCode, 1);
});

test("campaign dry runs still reject an unusable campaign without a placement", async () => {
  const api = {} as SuperwallApi;
  let stdout = "";

  await executeCommand(
    runResource("campaigns").definition,
    {
      _: [],
      $0: "superwall",
      action: "create",
      value: "Upgrade",
      dryRun: true,
      json: true,
    },
    runtime(api, (value) => {
      stdout += value;
    }),
  );

  assert.match(JSON.parse(stdout).error.message, /at least one placement/);
  assert.equal(process.exitCode, 1);
});

test("--no-interactive keeps strict machine scope rules without prompting", async () => {
  const calls: Array<{ method: string; value?: unknown }> = [];
  const api = {
    list: async () => [
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ],
  } as unknown as SuperwallApi;

  await executeCommand(
    runResource("products").definition,
    { _: [], $0: "superwall", action: "list", interactive: false },
    {
      api: () => api,
      nonInteractive: false,
      renderer: () => recordingRenderer(calls),
      waitForPaint: false,
    },
  );

  assert.equal(
    calls.some((call) => call.method === "select"),
    false,
  );
  assert.deepEqual(
    calls.find((call) => call.method === "error")?.value,
    "Multiple projects found. Pass --project <id>.",
  );
  assert.equal(process.exitCode, 1);
});
