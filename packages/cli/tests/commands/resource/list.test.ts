import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runResource } from "@/commands/resource/resource";
import { createSuperwallApi } from "@/core/api/client";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { run } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
  process.exitCode = undefined;
});

const api = (orgId = "1") =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    orgId,
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

test("orgs --json is the API's own list, unshaped", async () => {
  useHome();
  const orgs = [{ id: 1, name: "Solo Inc", role: "owner" }];
  useFetch([{ match: "/v2/me/organizations", body: { data: orgs, has_more: false } }]);

  const result = await run(runResource("orgs").definition, {
    argv: { json: true },
    api: api(),
  });

  assert.deepEqual(result.json, orgs);
});

test("orgs lists each organization with its role", async () => {
  useHome();
  useFetch([
    {
      match: "/v2/me/organizations",
      body: { data: [{ id: 1, name: "Solo Inc", role: "owner" }], has_more: false },
    },
  ]);

  const result = await run(runResource("orgs").definition, { api: api() });

  const list = result.calls.find((call) => call.method === "list")?.value as {
    items: { label: string; badge?: string }[];
  };
  assert.equal(list.items[0]?.label, "Solo Inc");
  assert.equal(list.items[0]?.badge, "Owner");
  assert.match(result.said("step").join(), /1 organization/);
});

test("apps --json carries every project with its applications", async () => {
  useHome();
  const projects = [
    {
      id: 9,
      name: "P",
      applications: [{ id: 42, name: "My App", platform: "ios", public_api_key: "pk_live_wxyz" }],
    },
  ];
  useFetch([{ match: "/v2/projects", body: { data: projects, has_more: false } }]);

  const result = await run(runResource("apps").definition, { argv: { json: true }, api: api() });

  assert.deepEqual(result.json, projects);
});

test("apps shows each app under its project, keyed by bundle id", async () => {
  useHome();
  useFetch([
    {
      match: "/v2/projects",
      body: {
        data: [
          {
            id: 9,
            name: "P",
            applications: [
              { id: 42, bundle_id: "com.example.app", platform: "ios", public_api_key: "pk_wxyz" },
            ],
          },
        ],
        has_more: false,
      },
    },
  ]);

  const result = await run(runResource("apps").definition, { api: api() });

  const list = result.calls.find((call) => call.method === "list")?.value as {
    items: { label: string; children: { label: string; meta?: string; badge?: string }[] }[];
  };
  const app = list.items[0]?.children[0];
  assert.equal(app?.label, "com.example.app");
  assert.equal(app?.meta, "pk_…wxyz");
  assert.match(String(app?.badge), /iOS/i);
});

test("an unknown action names the resource it does not belong to", async () => {
  useHome();

  const result = await run(runResource("products").definition, {
    argv: { action: "teleport" },
    api: api(),
  });

  assert.match(result.said("error").join(), /Unknown action "teleport" for products/);
  assert.equal(process.exitCode, 1);
});

test("a project-scoped resource is asked for within its project", async () => {
  useHome();
  const log = useFetch([
    {
      match: "/v2/projects",
      body: {
        data: [{ id: 9, name: "P", applications: [{ id: 42, name: "A", platform: "ios" }] }],
        has_more: false,
      },
    },
    { match: "/v2/products", body: { data: [{ id: 5, name: "monthly" }], has_more: false } },
  ]);

  const result = await run(runResource("products").definition, {
    argv: { json: true, app: "42" },
    api: api(),
  });

  assert.deepEqual(result.json, [{ id: 5, name: "monthly" }]);
  assert.ok(
    log.some((entry) => entry.url.includes("/v2/products?project_id=9")),
    log.map((entry) => entry.url).join("\n"),
  );
});

test("an app-scoped resource is asked for within the chosen app", async () => {
  useHome();
  const log = useFetch([
    {
      match: "/v2/projects",
      body: {
        data: [{ id: 9, name: "P", applications: [{ id: 42, name: "A", platform: "ios" }] }],
        has_more: false,
      },
    },
    { match: "/v2/paywalls", body: { data: [{ id: 7, name: "Pro" }], has_more: false } },
  ]);

  const result = await run(runResource("paywalls").definition, {
    argv: { json: true, app: "42" },
    api: api(),
  });

  assert.deepEqual(result.json, [{ id: 7, name: "Pro" }]);
  assert.ok(
    log.some((entry) => entry.url.includes("/v2/paywalls?application_id=42")),
    log.map((entry) => entry.url).join("\n"),
  );
});
