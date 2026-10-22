import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ApiError } from "@/core/api/client";
import { buildAccountTree, renderAccountTree } from "@/core/main/bootstrap";
import { clearHomes, useHome } from "../../helpers/home";
import { routedApi, type Reply } from "../../helpers/routed-api";

beforeEach(() => {
  useHome();
});

afterEach(() => {
  clearHomes();
});

const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, "");

const IOS = { id: 10, name: "Lab", platform: "ios", bundle_id: "com.acme.lab", public_api_key: "pk_live_abcd" };
const WEB = { id: 11, name: "Lab Web", platform: "web" };

const ROUTES: Record<string, Reply> = {
  "GET /v2/projects": [
    { id: 1, name: "Lab", organization_id: 9, applications: [IOS, WEB] },
    { id: 2, organization_id: 7, applications: [] },
  ],
  "GET /v2/me/organizations": { data: [{ id: 9, name: "Acme" }] },
  "GET /v2/organizations/7": { id: 7, name: "Partner" },
  "GET /v2/products?project_id=1": [
    { id: "p1", identifier: "pro_monthly", platform: "ios" },
    { id: "p2", identifier: "stripe_pro", platform: "stripe" },
  ],
  "GET /v2/entitlements?project_id=1": [{ id: "e1", identifier: "pro" }],
  "GET /v2/campaigns?application_id=10": [
    {
      id: "c1",
      description: "Onboarding",
      placements: [{ event_name: "campaign_trigger" }, { event_name: "old", enabled: false }, { id: "pl3" }],
    },
  ],
  "GET /v2/paywalls?application_id=10": [{ id: "w1", name: "Main" }],
  "GET /v2/campaigns?application_id=11": [{ id: "c2", name: "Web upsell" }],
  "GET /v2/paywalls?application_id=11": new ApiError("GET /v2/paywalls", 403, "forbidden"),
  "GET /v2/products?project_id=2": [],
  "GET /v2/entitlements?project_id=2": [],
};

test("the account tree hangs each app's campaigns, paywalls and store products under its project", async () => {
  const { api } = routedApi(ROUTES);
  const text = plain(renderAccountTree(await buildAccountTree(api, {})));
  assert.equal(
    text,
    [
      "└── Acme  #9",
      "    └── Lab  #1",
      "        ├── iOS · com.acme.lab  pk_…abcd",
      "        │   ├── campaigns (1)",
      "        │   │   └── Onboarding  #c1",
      "        │   │       ├── campaign_trigger",
      "        │   │       ├── old · disabled",
      "        │   │       └── pl3",
      "        │   ├── paywalls (1)",
      "        │   │   └── Main  #w1",
      "        │   ├── products (1)",
      "        │   │   └── pro_monthly  #p1",
      "        │   └── entitlements (1)",
      "        │       └── pro  #e1",
      "        ├── Web · Lab Web  #11",
      "        │   ├── campaigns (1)",
      "        │   │   └── Web upsell  #c2",
      "        │   ├── paywalls (0)",
      "        │   ├── products (0)",
      "        │   └── entitlements (1)",
      "        │       └── pro  #e1",
      "        └── products (no app) (1)",
      "            └── stripe_pro  #p2",
      "└── Partner  #7 · not a member",
      "    └── 2  #2",
    ].join("\n"),
  );
});

test("a failure other than a missing or forbidden list stops the tree", async () => {
  const { api } = routedApi({
    ...ROUTES,
    "GET /v2/products?project_id=2": new ApiError("GET /v2/products", 500, '{"message":"boom"}'),
  });
  await assert.rejects(buildAccountTree(api, {}), /boom/);
});

test("--project scopes the tree to that project, even outside your organizations", async () => {
  const { api, sent } = routedApi({
    ...ROUTES,
    "GET /v2/projects/2": { id: 2, name: "Shared", organization_id: 5, applications: [] },
    "GET /v2/projects?organization_id=5": [],
  });
  const tree = await buildAccountTree(api, { project: "2" });
  assert.deepEqual(
    tree.organizations.map((org) => ({ id: org.id, member: org.member, projects: org.projects.map((p) => p.name) })),
    [{ id: "5", member: false, projects: ["Shared"] }],
  );
  assert.ok(!sent.some((request) => request.path.includes("project_id=1")));
});

test("--app scopes the tree to the app's project in its own organization", async () => {
  const { api } = routedApi(ROUTES);
  const tree = await buildAccountTree(api, { app: "10" });
  assert.deepEqual(
    tree.organizations.map((org) => ({ name: org.name, projects: org.projects.map((p) => p.id) })),
    [{ name: "Acme", projects: [1] }],
  );
});
