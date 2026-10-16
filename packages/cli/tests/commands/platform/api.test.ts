import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runApi, runBootstrap } from "@/commands/platform/api";
import { createSuperwallApi } from "@/core/api/client";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { run } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  process.exitCode = 0;
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

const page = (data: unknown[]) => ({ data, has_more: false });

const mine = {
  id: "282",
  name: "Mine",
  organization_id: 3642,
  applications: [{ id: "5861", name: "Demo", platform: "ios" }],
};
const empty = { id: "235", name: "New Project", organization_id: 3642, applications: [] };

const accountRoutes = [
  { match: "/v2/me/organizations", body: page([{ id: 3642, name: "Demo Inc" }]) },
  { match: "/v2/products?project_id=282", body: page([{ id: "p1", identifier: "pro" }]) },
  { match: "/v2/entitlements?project_id=282", body: page([]) },
  { match: "/v2/campaigns?application_id=5861", body: page([{ id: "c1" }]) },
  { match: "/v2/paywalls?application_id=5861", body: page([{ id: "w1" }, { id: "w2" }]) },
];

type Tree = {
  organizations: {
    name: string;
    projects: { id: string; products: unknown[]; applications_full: { paywalls: unknown[] }[] }[];
  }[];
};

test("bootstrap loads every project's tree, and a project it can't read counts as empty", async () => {
  useHome();
  useFetch([
    ...accountRoutes,
    {
      match: "/v2/products?project_id=235",
      status: 404,
      body: { error: { message: "No such project: '235'" } },
    },
    { match: "/v2/entitlements?project_id=235", status: 404, body: {} },
    { match: "/v2/projects", body: page([mine, empty]) },
  ]);
  const result = await run(runBootstrap.definition, { argv: { json: true }, api: api() });
  const tree = result.json as Tree;
  assert.equal(tree.organizations[0]!.name, "Demo Inc");
  const [one, two] = tree.organizations[0]!.projects;
  assert.equal(one!.products.length, 1);
  assert.equal(one!.applications_full[0]!.paywalls.length, 2);
  assert.deepEqual(two!.products, []);
});

test("bootstrap --app loads only that app's project, even in an organization you aren't in", async () => {
  useHome();
  const log = useFetch([
    { match: "/v2/paywalls?application_id=5861&limit=1", body: page([{ project_id: "282" }]) },
    { match: "/v2/projects?limit", body: page([empty]) },
    { match: "/v2/projects/282", body: mine },
    { match: "/v2/projects?organization_id=3642", body: page([mine, empty]) },
    ...accountRoutes,
  ]);
  const result = await run(runBootstrap.definition, {
    argv: { json: true, app: "5861" },
    api: api(),
  });
  const tree = result.json as Tree;
  assert.ok(tree.organizations, JSON.stringify(result.json));
  assert.deepEqual(
    tree.organizations.map((org) => org.projects.map((p) => p.id)),
    [["282"]],
  );
  assert.ok(
    !log.some((entry) => entry.url.includes("project_id=235")),
    "other projects aren't loaded",
  );
});

test("bootstrap --app with an app nobody can open fails with what to pass", async () => {
  useHome();
  useFetch([
    { match: "/v2/projects", body: page([mine]) },
    { match: "/v2/paywalls?application_id=77", body: page([]) },
  ]);
  const result = await run(runBootstrap.definition, {
    argv: { json: true, app: "77" },
    api: api(),
  });
  assert.match(JSON.stringify(result.json), /No app 77 that this account can open/);
});

test("bootstrap --project with a project nobody can open says so", async () => {
  useHome();
  useFetch([
    { match: "/v2/projects/999", status: 404, body: {} },
    { match: "/v2/projects", body: page([mine]) },
  ]);
  const result = await run(runBootstrap.definition, {
    argv: { json: true, project: "999" },
    api: api(),
  });
  assert.match(JSON.stringify(result.json), /No project 999 that this account can open/);
});

const spec = {
  info: { version: "2.0.0" },
  paths: {
    "/v2/campaigns/{id}/audiences/{audience_id}/variants": {
      post: { tags: ["Campaigns V2"], summary: "Create Variant", responses: {} },
    },
  },
};

test("a raw request the API rejects carries the reference entry to read", async () => {
  useHome();
  useFetch([
    { match: "/openapi.json", body: spec },
    {
      match: "/v2/campaigns/1/audiences/2/variants",
      status: 400,
      body: { error: { message: 'Expected "treatment" | "holdout"' } },
    },
  ]);
  const result = await run(runApi("post").definition, {
    argv: { json: true, path: "/v2/campaigns/1/audiences/2/variants", d: ["type=nope"] },
    api: api(),
  });
  const message = (result.json as { error: { message: string } }).error.message;
  assert.match(message, /treatment/);
  assert.match(
    message,
    /superwall api docs \/v2\/campaigns\/\{id\}\/audiences\/\{audience_id\}\/variants post/,
  );
});

test("a raw request that succeeds prints the API's answer, and a server error is left as it is", async () => {
  useHome();
  useFetch([
    { match: "/v2/projects/282", body: mine },
    { match: "/v2/broken", status: 401, body: { error: { message: "Unauthorized" } } },
  ]);
  const ok = await run(runApi("get").definition, {
    argv: { json: true, path: "/v2/projects/282" },
    api: api(),
  });
  assert.equal((ok.json as { id: string }).id, "282");
  const denied = await run(runApi("get").definition, {
    argv: { json: true, path: "/v2/broken" },
    api: api(),
  });
  assert.doesNotMatch(JSON.stringify(denied.json), /api docs/);
});
