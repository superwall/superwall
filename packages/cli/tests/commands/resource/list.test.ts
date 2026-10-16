import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
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
  process.exitCode = 0;
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
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
  assert.equal(app?.meta, "42  pk_…wxyz");
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

const homeProjects = [
  {
    id: 282,
    name: "Home",
    organization_id: 3642,
    applications: [{ id: 5861, name: "Demo", platform: "ios" }],
  },
  {
    id: 283,
    name: "Testing",
    organization_id: 3642,
    applications: [{ id: 5862, name: "Lab", platform: "ios" }],
  },
];
const writeThis = {
  id: 887,
  name: "WriteThis",
  organization_id: 1,
  applications: [{ id: 1022, name: "WriteThis iOS", platform: "ios" }],
};
const page = (data: unknown[]) => ({ data, has_more: false });

test("--app opens an app in an organization the account isn't a member of", async () => {
  useHome();
  useFetch([
    { match: "/v2/projects?limit", body: page(homeProjects) },
    { match: "/v2/projects/887", body: writeThis },
    {
      match: "/v2/paywalls?application_id=1022",
      body: page([{ id: 274523, name: "Onboarding", project_id: "887", application_id: "1022" }]),
    },
  ]);

  const result = await run(runResource("paywalls").definition, {
    argv: { app: "1022", json: true },
    api: api(),
  });

  assert.equal(process.exitCode, 0);
  assert.deepEqual(
    (result.json as { id: number }[]).map((row) => row.id),
    [274523],
  );
});

test("--project opens a project in another organization by id", async () => {
  useHome();
  useFetch([
    { match: "/v2/projects?limit", body: page(homeProjects) },
    { match: "/v2/projects/887", body: writeThis },
    { match: "/v2/products?project_id=887", body: page([{ id: 5, identifier: "pro_annual" }]) },
  ]);

  const result = await run(runResource("products").definition, {
    argv: { project: "887", json: true },
    api: api(),
  });

  assert.equal(process.exitCode, 0);
  assert.deepEqual(result.json, [{ id: 5, identifier: "pro_annual" }]);
});

test("--app remembers the organization it opened, so apps lists it, marked not a member", async () => {
  const home = useHome();
  useFetch([
    { match: "/v2/projects?limit", body: page(homeProjects) },
    { match: "/v2/projects?organization_id=1", body: page([writeThis]) },
    { match: "/v2/projects/887", body: writeThis },
    {
      match: "/v2/paywalls?application_id=1022",
      body: page([{ id: 274523, name: "Onboarding", project_id: "887", application_id: "1022" }]),
    },
    { match: "/v2/me/organizations", body: page([{ id: 3642, name: "Demo Inc", role: "owner" }]) },
    { match: "/v2/organizations/1", body: { id: 1, name: "Jake Mor" } },
  ]);

  await run(runResource("paywalls").definition, { argv: { app: "1022", json: true }, api: api() });
  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as {
    openedOrgs?: string[];
  };
  assert.deepEqual(config.openedOrgs, ["1"]);

  const rich = await run(runResource("apps").definition, { api: api() });
  const steps = rich.said("step");
  assert.ok(
    steps.some((step) => /`Demo Inc` · 2 projects/.test(step)),
    steps.join("\n"),
  );
  assert.ok(
    steps.some((step) => /`Jake Mor` \(not a member\) · 1 project/.test(step)),
    steps.join("\n"),
  );

  const json = await run(runResource("apps").definition, { argv: { json: true }, api: api() });
  const rows = json.json as { id: number; organization: { id: string; member: boolean } }[];
  assert.deepEqual(
    rows.map((row) => [row.id, row.organization.id, row.organization.member]),
    [
      [282, "3642", true],
      [283, "3642", true],
      [887, "1", false],
    ],
  );
});

test("an opened organization that no longer answers is forgotten", async () => {
  const home = useHome();
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ openedOrgs: ["1"] }));
  useFetch([
    { match: "/v2/projects?limit", body: page(homeProjects) },
    { match: "/v2/projects?organization_id=1", status: 403, body: { error: "no" } },
    { match: "/v2/me/organizations", body: page([{ id: 3642, name: "Demo Inc", role: "owner" }]) },
  ]);

  const result = await run(runResource("apps").definition, { argv: { json: true }, api: api() });

  assert.equal((result.json as unknown[]).length, 2);
  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as {
    openedOrgs?: string[];
  };
  assert.deepEqual(config.openedOrgs, []);
});

test("when the API asks for an organization, projects are listed for each membership", async () => {
  useHome();
  const log = useFetch([
    {
      match: "/v2/projects?limit",
      status: 400,
      body: { error: { code: "parameter_missing", message: "organization_id is required" } },
    },
    {
      match: "/v2/me/organizations",
      body: page([
        { id: 3642, name: "Demo Inc" },
        { id: 7, name: "Lab" },
        { id: 7, name: "Lab" },
      ]),
    },
    { match: "/v2/projects?organization_id=3642", body: page(homeProjects) },
    { match: "/v2/projects?organization_id=7", body: page([]) },
  ]);

  const result = await run(runResource("apps").definition, { argv: { json: true }, api: api() });

  assert.deepEqual(
    (result.json as { id: number; organization: { name: string } }[]).map((row) => [
      row.id,
      row.organization.name,
    ]),
    [
      [282, "Demo Inc"],
      [283, "Demo Inc"],
    ],
  );
  assert.ok(log.some((entry) => entry.url.includes("organization_id=7")));
});

const manyPaywalls = Array.from({ length: 1000 }, (_, i) => ({
  id: 5000 + i,
  name: i % 100 === 0 ? `Onboarding ${i}` : `Paywall ${i}`,
  identifier: i === 7 ? "winback-offer" : `pw-${i}`,
}));

const oneApp = [{ id: 9, name: "P", applications: [{ id: 42, name: "App", platform: "ios" }] }];

function paywallsApi() {
  useFetch([
    { match: "/v2/projects", body: page(oneApp) },
    { match: "/v2/paywalls?application_id=42", body: page(manyPaywalls) },
  ]);
  return api();
}

test("--search narrows a thousand paywalls by name, identifier or id, case-insensitively", async () => {
  useHome();
  const byName = await run(runResource("paywalls").definition, {
    argv: { json: true, search: "ONBOARDING" },
    api: paywallsApi(),
  });
  assert.equal((byName.json as unknown[]).length, 10);

  const byIdentifier = await run(runResource("paywalls").definition, {
    argv: { json: true, search: "winback" },
    api: paywallsApi(),
  });
  assert.deepEqual(
    (byIdentifier.json as { id: number }[]).map((row) => row.id),
    [5007],
  );

  const byId = await run(runResource("paywalls").definition, {
    argv: { json: true, search: "5999" },
    api: paywallsApi(),
  });
  assert.deepEqual(
    (byId.json as { id: number }[]).map((row) => row.id),
    [5999],
  );
});

test("--json returns every row unless --limit caps it", async () => {
  useHome();
  const all = await run(runResource("paywalls").definition, {
    argv: { json: true },
    api: paywallsApi(),
  });
  assert.equal((all.json as unknown[]).length, 1000);
  const capped = await run(runResource("paywalls").definition, {
    argv: { json: true, limit: 3 },
    api: paywallsApi(),
  });
  assert.deepEqual(
    (capped.json as { id: number }[]).map((row) => row.id),
    [5000, 5001, 5002],
  );
});

test("in a terminal, a long list shows fifty rows and says how to see the rest", async () => {
  useHome();
  const result = await run(runResource("paywalls").definition, { api: paywallsApi() });
  const list = result.calls.find((call) => call.method === "list")?.value as { items: unknown[] };
  assert.equal(list.items.length, 50);
  assert.match(result.said("step").join(), /1000 paywalls/);
  assert.match(result.said("info").join(), /…950 more\. Narrow with --search/);
});

test("a search that matches nothing says so instead of an empty list", async () => {
  useHome();
  const result = await run(runResource("paywalls").definition, {
    argv: { search: "nope-nothing" },
    api: paywallsApi(),
  });
  assert.match(result.said("step").join(), /0 paywalls matching "nope-nothing", of 1000/);
});

test("--limit must be a positive whole number", async () => {
  useHome();
  const result = await run(runResource("paywalls").definition, {
    argv: { json: true, limit: 0 },
    api: paywallsApi(),
  });
  assert.match(JSON.stringify(result.json), /--limit takes a whole number above 0/);
});

test("apps --search keeps a matching project whole, and otherwise only its matching apps", async () => {
  useHome();
  useFetch([
    {
      match: "/v2/projects",
      body: page([
        {
          id: 1,
          name: "Natural Camera",
          applications: [
            { id: 11, name: "iOS app" },
            { id: 12, name: "Web" },
          ],
        },
        {
          id: 2,
          name: "Other",
          applications: [
            { id: 21, name: "camera-lite" },
            { id: 22, name: "unrelated" },
          ],
        },
        { id: 3, name: "Nothing", applications: [{ id: 31, name: "x" }] },
      ]),
    },
  ]);
  const result = await run(runResource("apps").definition, {
    argv: { json: true, search: "camera" },
    api: api(),
  });
  assert.deepEqual(
    (result.json as { id: number; applications: { id: number }[] }[]).map((p) => [
      p.id,
      p.applications.map((a) => a.id),
    ]),
    [
      [1, [11, 12]],
      [2, [21]],
    ],
  );
});
