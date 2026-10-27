import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Catalog } from "@/program/command";
import type { SuperwallApi } from "@/core/api/client";
import type { DocOperation } from "@/core/api/reference";
import { command as apps } from "@/commands/main/apps";
import { command as campaigns } from "@/commands/main/campaigns";
import { command as entitlements } from "@/commands/main/entitlements";
import { command as events } from "@/commands/main/events";
import { command as paywalls } from "@/commands/main/paywalls";
import { command as products } from "@/commands/main/products";
import { command as users } from "@/commands/main/users";
import { command as webhooks } from "@/commands/main/webhooks";
import { defineResource } from "@/core/main/define";
import { answeringRenderer as answering, said } from "../../helpers/answers";
import { runCommand } from "../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const CATALOGS: Record<string, Catalog> = { apps, campaigns, entitlements, events, paywalls, products, users, webhooks };

const op = (method: string, path: string, extra: Partial<DocOperation> = {}): DocOperation => ({
  method,
  path,
  group: "Test",
  summary: `${method} ${path}`,
  params: [],
  returns: [],
  ...extra,
});

const SPEC: DocOperation[] = [
  op("PATCH", "/v2/projects/{id}/applications/{application_id}/settings", {
    body: [
      { name: "team_id", type: "string | null", required: false, description: "Apple team ID" },
      { name: "bundle_id", type: "string | null", required: false },
      { name: "redeemable_on_desktop", type: "boolean | null", required: false },
    ],
  }),
  op("POST", "/v2/campaigns/{id}/placements", {
    body: [{ name: "event_name", type: "string", required: true, description: "Event name" }],
  }),
  op("DELETE", "/v2/products/{id}"),
  op("POST", "/v2/gadgets", {
    body: [
      { name: "tags", type: "string[]", required: false },
      { name: "sizes", type: "number[]", required: false },
      { name: "config", type: "object", required: false },
      { name: "extra", type: "any", required: false },
      { name: "cleared", type: "null", required: false },
      { name: "label", type: "string", required: false },
      { name: "count", type: "integer", required: false },
      { name: "enabled", type: "boolean", required: false },
      { name: "project_id", type: "integer", required: false },
      { name: "rules", type: "object[]", required: false },
    ],
  }),
  op("GET", "/v2/projects/{project_id}/webhook_endpoints", {
    params: [{ name: "limit", in: "query", type: "number", required: false }],
  }),
  op("GET", "/v2/users/resolve", {
    params: [
      { name: "application_id", in: "query", type: "string", required: true },
      { name: "app_user_id", in: "query", type: "string", required: true },
    ],
  }),
];

const PROJECTS = [
  { id: "282", name: "test", organization_id: 3642, applications: [{ id: "5861", name: "Demo", platform: "ios" }] },
];

beforeEach(() => {
  const home = process.env.SUPERWALL_HOME!;
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "api-index.json"),
    JSON.stringify({ version: "test", fetchedAt: Date.now(), operations: SPEC }),
  );
});

afterEach(() => {
  process.exitCode = undefined;
});

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function fakeApi(calls: Call[], responses: Record<string, unknown> = {}, projects: unknown[] = PROJECTS): SuperwallApi {
  const answer = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, ...(body === undefined ? {} : { body }) });
    return Promise.resolve(responses[`${method} ${path}`] ?? { ok: true });
  };
  return {
    org: {},
    userEmail: undefined,
    host: "https://api.example.com",
    forOrg: () => fakeApi(calls, responses, projects),
    list: async (path: string) => (path.startsWith("/v2/projects") && !path.includes("webhook") ? projects : []),
    get: (path: string) => answer("GET", path),
    post: (path: string, body: unknown) => answer("POST", path, body),
    put: (path: string, body: unknown) => answer("PUT", path, body),
    patch: (path: string, body: unknown) => answer("PATCH", path, body),
    del: (path: string) => answer("DELETE", path),
    postText: async () => "",
  } as unknown as SuperwallApi;
}

function answeringRenderer(prompts: RendererCall[] | undefined) {
  const renderer = recordingRenderer();
  if (!prompts) return renderer;
  return {
    ...renderer,
    select: async (value: { options: { value: unknown }[] }) => {
      prompts.push({ method: "select", value });
      return value.options[0]!.value;
    },
  } as typeof renderer;
}

async function run(words: string[], flags: Record<string, unknown>, api: SuperwallApi, prompts?: RendererCall[]): Promise<any> {
  const [name, ...rest] = words;
  const { json = true, ...given } = flags;
  const result = await runCommand(CATALOGS[name!]!, {
    words: rest,
    flags: given,
    json: json === true,
    api,
    interactive: prompts !== undefined,
    renderer: answeringRenderer(prompts),
  });
  return result.json;
}

test("every operation is either an API call or a known hand-written handler, named once", () => {
  const define = (operations: Parameters<typeof defineResource>[0]["operations"]) =>
    defineResource({ name: "things", summary: "Things", operations, examples: [["things list", "Things"]] });
  assert.throws(() => define([{ name: "list", summary: "List", handler: "nope" }]), /neither an API call nor a known handler/);
  assert.throws(() => define([{ name: "get", summary: "Get" }]), /neither an API call nor a known handler/);
  assert.throws(
    () => define([{ name: "list", summary: "List", handler: "resource" }, { name: "list", summary: "Again", handler: "resource" }]),
    /repeats an operation name/,
  );
  assert.equal(Object.keys(CATALOGS).length, 8);
});

test("an app's own operations take the app as their argument, not its project or app id", async () => {
  const calls: Call[] = [];
  await run(["apps", "update", "5861"], { teamId: "ABC" }, fakeApi(calls));
  assert.deepEqual(calls.map((call) => call.path), ["/v2/projects/282/applications/5861/settings"]);
  const out = await run(["campaigns", "variants", "update"], {}, fakeApi([]));
  assert.match(out.error.message, /Usage: superwall campaigns variants update <campaign> <audience> <variant>/);
});

test("apps update sends typed flags to the app's settings, its ids filled from the app", async () => {
  const calls: Call[] = [];
  await run(["apps", "update", "5861"], { teamId: "ABC", redeemableOnDesktop: "true" }, fakeApi(calls));
  assert.deepEqual(calls, [
    {
      method: "PATCH",
      path: "/v2/projects/282/applications/5861/settings",
      body: { team_id: "ABC", redeemable_on_desktop: true },
    },
  ]);
});

test("a nested operation takes its parent's id as a positional", async () => {
  const calls: Call[] = [];
  await run(["campaigns", "placements", "create", "9081"], { eventName: "onboarding", yes: true }, fakeApi(calls));
  assert.deepEqual(calls, [
    { method: "POST", path: "/v2/campaigns/9081/placements", body: { event_name: "onboarding" } },
  ]);
});

test("a flag the endpoint doesn't take is refused before anything is sent", async () => {
  const calls: Call[] = [];
  const out = await run(["apps", "update", "5861"], { nope: "1" }, fakeApi(calls));
  assert.equal(calls.length, 0);
  assert.match(out.error.message, /has no --nope/);
  assert.equal(process.exitCode, 1);
});

test("a destructive operation outside a terminal needs --yes", async () => {
  const calls: Call[] = [];
  const out = await run(["products", "delete", "12"], {}, fakeApi(calls));
  assert.equal(calls.length, 0);
  assert.match(out.error.message, /Pass --yes/);

  await run(["products", "delete", "12"], { yes: true }, fakeApi(calls));
  assert.deepEqual(calls, [{ method: "DELETE", path: "/v2/products/12" }]);
});

test("--dry-run prints the request instead of sending it", async () => {
  const calls: Call[] = [];
  const out = await run(["apps", "update", "5861"], { teamId: "ABC", dryRun: true }, fakeApi(calls));
  assert.equal(calls.length, 0);
  assert.deepEqual(out, {
    method: "PATCH",
    path: "/v2/projects/282/applications/5861/settings",
    body: { team_id: "ABC" },
  });
});

test("a list fills its project from --app and returns the rows", async () => {
  const calls: Call[] = [];
  const rows = [{ id: "ep_1", url: "https://example.com/hook" }];
  const out = await run(
    ["webhooks", "list"],
    { app: "5861" },
    fakeApi(calls, { "GET /v2/projects/282/webhook_endpoints": { data: rows } }),
  );
  assert.deepEqual(out, rows);
});

test("a positional can fill a query param, next to the app's id", async () => {
  const calls: Call[] = [];
  await run(["users", "get", "user_1"], { app: "5861" }, fakeApi(calls));
  assert.deepEqual(calls, [{ method: "GET", path: "/v2/users/resolve?app_user_id=user_1&application_id=5861" }]);
});

test("too few ids says the usage", async () => {
  const out = await run(["campaigns", "placements", "create"], {}, fakeApi([]));
  assert.match(out.error.message, /Usage: superwall campaigns placements create <campaign>/);
});

test("a resource's help lists its operations and nested resources", async () => {
  const help = await campaigns.help([]);
  for (const word of ["get", "archive", "campaigns placements", "campaigns variants", "weights"]) {
    assert.ok(help.includes(word), word);
  }
  assert.ok(!help.includes("placement <campaign>"), "hidden operations stay out");
});

test("an operation's help takes its flags from the API reference", async () => {
  const help = await apps.help(["update"]);
  assert.match(help, /--team-id/);
  assert.match(help, /Apple team ID/);
  assert.match(help, /--redeemable-on-desktop/);
  assert.match(help, /<app>/);
});

test("apps update --bundle-id asks first when reported builds would run in test mode", async () => {
  const suggestions = {
    "GET /internal/v2/applications/5861/bundle-id-suggestions": {
      window_days: 30,
      available: true,
      candidates: [
        { bundle_id: "com.acme.old", production_devices: 4, sandbox_devices: 0, last_seen_at: "2026-10-15", top_country: null },
      ],
    },
  };
  const refused: Call[] = [];
  await run(["apps", "update", "5861"], { bundleId: "com.acme.demo" }, fakeApi(refused, suggestions));
  assert.equal(process.exitCode, 1);
  assert.deepEqual(refused.filter((call) => call.method !== "GET"), [], "nothing saved without --yes");

  process.exitCode = undefined;
  const calls: Call[] = [];
  await run(["apps", "update", "5861"], { bundleId: "com.acme.demo", teamId: "ABC", yes: true }, fakeApi(calls, suggestions));
  assert.deepEqual(calls.filter((call) => call.method !== "GET"), [
    {
      method: "PATCH",
      path: "/v2/projects/282/applications/5861/settings",
      body: { bundle_id: "com.acme.demo", team_id: "ABC" },
    },
  ]);
});

test("apps update --bundle-id asks which app once, then checks and saves that app", async () => {
  const projects = [
    { id: "282", name: "test", applications: [{ id: "5861", name: "Demo", platform: "ios" }] },
    { id: "283", name: "other", applications: [{ id: "5862", name: "Other", platform: "ios" }] },
  ];
  const calls: Call[] = [];
  const prompts: RendererCall[] = [];
  await run(["apps", "update"], { bundleId: "com.acme.app", json: false }, fakeApi(calls, {}, projects), prompts);
  assert.equal(prompts.length, 1);
  assert.deepEqual(calls.at(-1), {
    method: "PATCH",
    path: "/v2/projects/282/applications/5861/settings",
    body: { bundle_id: "com.acme.app" },
  });
});

test("--limit on a list operation takes a whole number above 0", async () => {
  const out = await run(["webhooks", "list"], { limit: 0 }, fakeApi([]));
  assert.match(out.error.message, /--limit takes a whole number above 0/);
});

const OVERVIEW = "GET /internal/v2/applications/5861/integrations/overview";
const PROVIDER = "/internal/v2/applications/5861/integrations/revenue-provider";

test("apps update --revenue-provider says what changes and needs --yes outside a terminal", async () => {
  const calls: Call[] = [];
  const responses = { [OVERVIEW]: { revenue_provider: "revenue_cat" } };
  const out = await run(["apps", "update", "5861"], { revenueProvider: "open_revenue" }, fakeApi(calls, responses));
  assert.match(out.error.message, /will count only events from open_revenue/);
  assert.match(out.error.message, /Nothing was changed\..*--yes/);
  assert.deepEqual(calls.filter((call) => call.method !== "GET"), []);
});

test("apps update --revenue-provider --yes changes it, and goes with the other fields", async () => {
  const responses = {
    [OVERVIEW]: { revenue_provider: "revenue_cat" },
    [`PATCH ${PROVIDER}`]: { revenue_provider: "open_revenue" },
  };
  const alone: Call[] = [];
  const out = await run(
    ["apps", "update", "5861"],
    { revenueProvider: "open_revenue", yes: true },
    fakeApi(alone, responses),
  );
  assert.deepEqual(out, {
    application_id: "5861",
    revenue_provider: { revenue_provider: "open_revenue", previous: "revenue_cat", changed: true },
  });
  assert.deepEqual(alone.filter((call) => call.method !== "GET"), [
    { method: "PATCH", path: PROVIDER, body: { revenue_provider: "open_revenue" } },
  ]);

  const both: Call[] = [];
  const merged = await run(
    ["apps", "update", "5861"],
    { revenueProvider: "open_revenue", teamId: "ABC", yes: true },
    fakeApi(both, responses),
  );
  assert.equal(merged.revenue_provider.changed, true);
  assert.deepEqual(both.at(-1), {
    method: "PATCH",
    path: "/v2/projects/282/applications/5861/settings",
    body: { team_id: "ABC" },
  });
});

test("apps update --revenue-provider leaves an unchanged provider alone and refuses unknown ones", async () => {
  const calls: Call[] = [];
  const same = await run(
    ["apps", "update", "5861"],
    { revenueProvider: "revenue_cat" },
    fakeApi(calls, { [OVERVIEW]: { revenue_provider: "revenue_cat" } }),
  );
  assert.equal(same.revenue_provider.changed, false);
  assert.deepEqual(calls.filter((call) => call.method !== "GET"), []);

  const bad = await run(["apps", "update", "5861"], { revenueProvider: "stripe" }, fakeApi([]));
  assert.match(bad.error.message, /--revenue-provider takes open_revenue or revenue_cat/);
});

test("create takes its values as flags, never positionals", async () => {
  const out = await run(["campaigns", "create", "Upsell", "onboarding"], {}, fakeApi([]));
  assert.match(out.error.message, /Usage: superwall campaigns create --description <text> --placement <placement>/);
});

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

  const result = await runCommand(products, { words: ["list"], json: true, api });

  assert.match(
    (result.json as { error: { message: string } }).error.message,
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

  const result = await runCommand(products, { words: ["list"], flags: { project: "2" }, json: true, api });

  assert.deepEqual(paths, ["/v2/projects", "/v2/products?project_id=2"]);
  assert.deepEqual(result.json, [{ id: "product-2", identifier: "pro_yearly" }]);
});

test("machine app-scoped commands require --app when a project has several apps", async () => {
  const api = {
    list: async () => [{ id: 1, name: "One", applications: [{ id: 10 }, { id: 11 }] }],
  } as unknown as SuperwallApi;

  const result = await runCommand(campaigns, { words: ["list"], json: true, api });

  assert.match((result.json as { error: { message: string } }).error.message, /pass --app <id>/);
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

  await runCommand(products, {
    words: ["create"],
    flags: { identifier: "test:price_1:7days-free", project: "1", app: "11" },
    json: true,
    api,
  });

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

  const result = await runCommand(products, {
    words: ["create"],
    flags: { identifier: "test:price_1:7days-free", project: "1", app: "99" },
    json: true,
    api,
  });

  assert.match((result.json as { error: { message: string } }).error.message, /No app 99 in Lab/);
  assert.equal(process.exitCode, 1);
});

test("campaign dry runs still reject an unusable campaign without a placement", async () => {
  const result = await runCommand(campaigns, {
    words: ["create"],
    flags: { description: "Upgrade", dryRun: true },
    json: true,
    api: {},
  });

  assert.match((result.json as { error: { message: string } }).error.message, /at least one placement/);
  assert.equal(process.exitCode, 1);
});

test("--no-interactive keeps strict machine scope rules without prompting", async () => {
  const calls: RendererCall[] = [];
  const api = {
    list: async () => [
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ],
  } as unknown as SuperwallApi;

  await runCommand(products, { words: ["list"], api, renderer: recordingRenderer(calls) });

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
  await runCommand(products, { words: ["list"], api, renderer: recordingRenderer(calls) });
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
  await runCommand(campaigns, { words: ["list"], flags: { project: "887" }, api, renderer: recordingRenderer(calls) });
  assert.match(
    String(calls.find((call) => call.method === "error")?.value),
    /WriteThis has 2 apps - pass --app <id>:\n  1022  iOS  WriteThis\n  14280  Web  Write This/,
  );
});

const gadgets = defineResource({
  name: "gadgets",
  summary: "Gadgets",
  operations: [
    { name: "create", summary: "Make one", method: "POST", path: "/v2/gadgets" },
    { name: "members", summary: "Who is in the organization", method: "GET", path: "/v2/organizations/{organization_id}/members" },
    { name: "spin", summary: "Spin it", handler: "resource" },
  ],
  examples: [["gadgets create", "Make one"]],
});

async function gadget(words: string[], flags: Record<string, unknown>, calls: Call[] = [], projects: unknown[] = PROJECTS): Promise<any> {
  const result = await runCommand(gadgets, { words, flags, json: true, api: fakeApi(calls, {}, projects) });
  return result.json;
}

test("flags are typed by the API reference: lists, numbers, booleans, JSON objects and nulls, the project filled in", async () => {
  const calls: Call[] = [];
  await gadget(["create"], {
    tags: "a, b",
    sizes: ["1", "2"],
    config: '{"x":1}',
    extra: "{not json",
    cleared: "anything",
    label: 7,
    count: "12",
    enabled: "false",
  }, calls);
  assert.deepEqual(calls[0]?.body, {
    tags: ["a", "b"],
    sizes: [1, 2],
    config: { x: 1 },
    extra: "{not json",
    cleared: null,
    label: "7",
    count: 12,
    enabled: false,
    project_id: 282,
  });
});

test("objects a tool passes as values are sent as they are, the same as the JSON text the CLI parses", async () => {
  const fromTool: Call[] = [];
  await gadget(["create"], { config: { x: 1 }, rules: [{ a: 1 }, { b: [2] }] }, fromTool);
  const fromCli: Call[] = [];
  await gadget(["create"], { config: '{"x":1}', rules: ['{"a":1}', '{"b":[2]}'] }, fromCli);
  assert.deepEqual(fromTool[0]?.body, { config: { x: 1 }, rules: [{ a: 1 }, { b: [2] }], project_id: 282 });
  assert.deepEqual(fromTool[0]?.body, fromCli[0]?.body);
});

test("a list of objects given once is one JSON object or a JSON array, never split at its commas", async () => {
  const once: Call[] = [];
  await gadget(["create"], { rules: '{"a":1,"b":2}' }, once);
  assert.deepEqual(once[0]?.body, { rules: [{ a: 1, b: 2 }], project_id: 282 });
  const array: Call[] = [];
  await gadget(["create"], { rules: '[{"a":1},{"b":2}]' }, array);
  assert.deepEqual(array[0]?.body, { rules: [{ a: 1 }, { b: 2 }], project_id: 282 });
});

test("an organization's operation takes the organization of the app it is about", async () => {
  const calls: Call[] = [];
  await gadget(["members"], { app: "5861" }, calls);
  await gadget(["members"], {}, calls);
  assert.deepEqual(calls.map((call) => call.path), ["/v2/organizations/3642/members", "/v2/organizations/3642/members"]);
});

test("a hand-written operation of a resource the CLI doesn't know is refused", async () => {
  const out = await gadget(["spin"], {});
  assert.equal(out.error.message, 'Unknown resource "gadgets".');

  const spinning = defineResource({
    name: "products",
    summary: "Products",
    operations: [{ name: "spin", summary: "Spin it", handler: "resource" }],
    examples: [["products spin", "Spin"]],
  });
  const result = await runCommand(spinning, { words: ["spin"], json: true, api: fakeApi([]) });
  assert.equal((result.json as any).error.message, 'Unknown action "spin" for products.');
});

test("an app operation on a project with no app yet says which id it lacks", async () => {
  const out = await run(["apps", "statistics"], {}, fakeApi([], {}, [{ id: "282", name: "test", applications: [] }]));
  assert.equal(out.error.message, "superwall apps statistics needs application_id.");
});

test("in a terminal a destructive operation asks first, and only yes goes ahead", async () => {
  for (const [answer, sent] of [["yes", 1], ["no", 0]] as const) {
    const calls: Call[] = [];
    const prompts: RendererCall[] = [];
    await runCommand(products, {
      words: ["delete", "12"],
      api: fakeApi(calls),
      interactive: true,
      renderer: answering({ select: [answer] }, prompts),
    });
    assert.equal((prompts.find((call) => call.method === "select")?.value as any).message, "Delete a product: DELETE /v2/products/12?");
    assert.equal(calls.length, sent);
    if (!sent) assert.deepEqual(said(prompts, "error"), ["Cancelled. Nothing was changed."]);
  }
});

test("apps update --bundle-id in a terminal saves once the test-mode warning is accepted", async () => {
  const calls: Call[] = [];
  const prompts: RendererCall[] = [];
  const suggestions = {
    "GET /internal/v2/applications/5861/bundle-id-suggestions": {
      window_days: 30,
      available: true,
      candidates: [{ bundle_id: "com.acme.old", production_devices: 4, sandbox_devices: 0, last_seen_at: "2026-10-15", top_country: null }],
    },
  };
  await runCommand(apps, {
    words: ["update", "5861"],
    flags: { bundleId: "com.acme.demo" },
    api: fakeApi(calls, suggestions),
    interactive: true,
    renderer: answering({ select: ["yes"] }, prompts),
  });
  assert.equal((prompts.find((call) => call.method === "select")?.value as any).message, "Save it anyway");
  assert.deepEqual(calls.at(-1), {
    method: "PATCH",
    path: "/v2/projects/282/applications/5861/settings",
    body: { bundle_id: "com.acme.demo" },
  });
});

test("apps update --bundle-id --dry-run shows the request without asking about test mode", async () => {
  const calls: Call[] = [];
  const out = await run(["apps", "update", "5861"], { bundleId: "com.acme.demo", dryRun: true }, fakeApi(calls, {
    "GET /internal/v2/applications/5861/bundle-id-suggestions": {
      window_days: 30,
      available: true,
      candidates: [{ bundle_id: "com.acme.old", production_devices: 4, sandbox_devices: 0, last_seen_at: "2026-10-15", top_country: null }],
    },
  }));
  assert.deepEqual(out, { method: "PATCH", path: "/v2/projects/282/applications/5861/settings", body: { bundle_id: "com.acme.demo" } });
});

test("apps update --bundle-id on a project with no apps says so", async () => {
  const out = await run(["apps", "update"], { bundleId: "com.acme.demo", project: "282" }, fakeApi([], {}, [{ id: "282", name: "test", applications: [] }]));
  assert.equal(out.error.message, "test has no apps yet.");
});

test("apps update --revenue-provider names an unnamed app by its id", async () => {
  const projects = [{ id: "282", name: "test", applications: [{ id: "5861", platform: "ios" }] }];
  const out = await run(["apps", "update", "5861"], { revenueProvider: "open_revenue" }, fakeApi([], { [OVERVIEW]: { revenue_provider: "revenue_cat" } }, projects));
  assert.match(out.error.message, /dashboard for 5861 will count only/);
});

test("ids an operation doesn't take are refused, naming them", async () => {
  const none = await gadget(["create", "extra"], {});
  assert.equal(none.error.message, 'superwall gadgets create takes no arguments; got "extra".');
  const one = await run(["products", "delete", "12", "13"], { yes: true }, fakeApi([]));
  assert.equal(one.error.message, 'superwall products delete takes 1 argument; got "13".');
});
