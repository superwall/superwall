import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { executeCommand } from "@/command";
import { runResource } from "@/commands/resource/resource";
import type { SuperwallApi } from "@/core/api/client";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

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

  assert.match(
    JSON.parse(stdout).error.message,
    /pass --app <id\|dashboard link> or --project <id>/,
  );
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

  assert.match(JSON.parse(stdout).error.message, /pass --app <id>/);
  assert.equal(process.exitCode, 1);
});

test("products create --app creates the product under that app", async () => {
  const posts: Array<{ path: string; body: unknown }> = [];
  const api = {
    list: async () => [
      {
        id: 1,
        name: "Lab",
        applications: [
          { id: 10, name: "Lab", platform: "ios" },
          { id: 11, name: "Lab", platform: "web" },
        ],
      },
    ],
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      return { id: "p1", identifier: "test:price_1:7days-free" };
    },
  } as unknown as SuperwallApi;

  await executeCommand(
    runResource("products").definition,
    {
      _: [],
      $0: "superwall",
      action: "create",
      value: "test:price_1:7days-free",
      project: "1",
      app: "11",
      json: true,
    },
    runtime(api, () => {}),
  );

  assert.deepEqual(posts, [
    {
      path: "/v2/products",
      body: { project_id: "1", application_id: "11", identifier: "test:price_1:7days-free" },
    },
  ]);
});

test("products create --app rejects an app outside the project", async () => {
  const api = {
    list: async () => [{ id: 1, name: "Lab", applications: [{ id: 10, platform: "ios" }] }],
    post: async () => assert.fail("must not create"),
  } as unknown as SuperwallApi;
  let stdout = "";

  await executeCommand(
    runResource("products").definition,
    {
      _: [],
      $0: "superwall",
      action: "create",
      value: "test:price_1:7days-free",
      project: "1",
      app: "99",
      json: true,
    },
    runtime(api, (value) => {
      stdout += value;
    }),
  );

  assert.match(JSON.parse(stdout).error.message, /No app 99 in Lab/);
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
  assert.equal(
    calls.find((call) => call.method === "error")?.value,
    "You can open 2 projects - pass --app <id|dashboard link> or --project <id>:\n  1  One\n  2  Two",
  );
  assert.equal(process.exitCode, 1);
});

test("an account with many projects gets the first ten named and a pointer to the rest", async () => {
  const calls: RendererCall[] = [];
  const api = {
    list: async () =>
      Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        name: `P${i + 1}`,
        applications: [{ id: 100 + i }],
      })),
  } as unknown as SuperwallApi;
  await executeCommand(
    runResource("products").definition,
    { _: [], $0: "superwall", action: "list", interactive: false },
    {
      api: () => api,
      nonInteractive: true,
      renderer: () => recordingRenderer(calls),
      waitForPaint: false,
    },
  );
  const message = String(calls.find((call) => call.method === "error")?.value);
  assert.match(message, /^You can open 25 projects/);
  assert.match(message, /\n  1  P1  \(apps 100\)/);
  assert.doesNotMatch(message, /P11\b/);
  assert.match(message, /…and 15 more: `superwall apps list` lists them all\.$/);
});

test("a project with several apps names them when --app is missing", async () => {
  const calls: RendererCall[] = [];
  const api = {
    list: async () => [
      {
        id: 887,
        name: "WriteThis",
        applications: [
          { id: 1022, name: "WriteThis", platform: "ios" },
          { id: 14280, name: "Write This", platform: "web" },
        ],
      },
    ],
  } as unknown as SuperwallApi;
  await executeCommand(
    runResource("campaigns").definition,
    { _: [], $0: "superwall", action: "list", project: "887", interactive: false },
    {
      api: () => api,
      nonInteractive: true,
      renderer: () => recordingRenderer(calls),
      waitForPaint: false,
    },
  );
  assert.match(
    String(calls.find((call) => call.method === "error")?.value),
    /WriteThis has 2 apps - pass --app <id>:\n  1022  iOS  WriteThis\n  14280  Web  Write This/,
  );
});
