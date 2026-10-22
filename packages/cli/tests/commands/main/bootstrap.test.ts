import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as bootstrap } from "@/commands/main/bootstrap";
import { createSuperwallApi } from "@/core/api/client";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { runCommand } from "../../helpers/command";

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
  const result = await runCommand(bootstrap, { json: true, api: api() });
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
  const result = await runCommand(bootstrap, { flags: { app: "5861" }, json: true, api: api() });
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
  const result = await runCommand(bootstrap, { flags: { app: "77" }, json: true, api: api() });
  assert.match(JSON.stringify(result.json), /No app 77 that this account can open/);
});

test("bootstrap --project with a project nobody can open says so", async () => {
  useHome();
  useFetch([
    { match: "/v2/projects/999", status: 404, body: {} },
    { match: "/v2/projects", body: page([mine]) },
  ]);
  const result = await runCommand(bootstrap, { flags: { project: "999" }, json: true, api: api() });
  assert.match(JSON.stringify(result.json), /No project 999 that this account can open/);
});


test("bootstrap outside --json draws the tree under the signed-in email, and without one when it is unknown", async () => {
  useHome();
  useFetch([...accountRoutes, { match: "/v2/projects", body: page([mine]) }]);
  const signedIn = createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    userEmail: "ana@acme.dev",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });
  const named = await runCommand(bootstrap, { api: signedIn });
  assert.deepEqual(named.said("step"), ["ana@acme.dev"]);
  const tree = named.said("report").join("\n");
  assert.match(tree, /Demo Inc/);
  assert.match(tree, /Mine/);

  const anonymous = await runCommand(bootstrap, { api: api() });
  assert.deepEqual(anonymous.said("step"), []);
  assert.match(anonymous.said("report").join("\n"), /Demo/);
});
