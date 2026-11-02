import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { Catalog } from "@/program/command";
import { ApiError } from "@/core/api/client";
import { command as apps } from "@/commands/main/apps";
import { command as campaigns } from "@/commands/main/campaigns";
import { command as entitlements } from "@/commands/main/entitlements";
import { command as products } from "@/commands/main/products";
import { defineResource } from "@/core/main/define";
import type { Row } from "@/core/api/resources";
import { answeringRenderer, prompted, said, type Answers } from "../../helpers/answers";
import { runCommand } from "../../helpers/command";
import type { RendererCall } from "../../helpers/renderer";
import { routedApi, type Reply } from "../../helpers/routed-api";

afterEach(() => {
  process.exitCode = undefined;
});

const PROJECT = {
  id: "1",
  name: "Lab",
  organization_id: 9,
  applications: [{ id: "10", name: "Lab", platform: "ios" }],
};

const ENTITLEMENTS: Record<string, Reply> = {
  "GET /v2/projects/1": PROJECT,
  "GET /v2/entitlements?project_id=1": [
    { id: 5, identifier: "pro", application_id: 10 },
    { id: 6, identifier: "plus", application_id: 10 },
  ],
};

const SPLIT = {
  ...PROJECT,
  applications: [
    { id: "20", name: "Lab Android", platform: "android" },
    { id: "10", name: "Lab iOS", platform: "ios" },
    { id: "30", name: "Lab Web", platform: "stripe" },
  ],
};

function splitRoutes(entitlements: Row[]): Record<string, Reply> {
  return {
    "GET /v2/projects": [SPLIT],
    "GET /v2/projects/1": SPLIT,
    "GET /v2/entitlements?project_id=1": entitlements,
    "POST /v2/products": { id: "p9", identifier: "pro_monthly" },
  };
}

async function create(
  catalog: Catalog,
  flags: Record<string, unknown>,
  routes: Record<string, Reply> = {},
  { json = false, answers }: { json?: boolean; answers?: Answers } = {},
) {
  const { api, sent } = routedApi({ "GET /v2/projects": [PROJECT], ...routes });
  const calls: RendererCall[] = [];
  const result = await runCommand(catalog, {
    words: ["create"],
    flags,
    json,
    api,
    interactive: answers !== undefined,
    renderer: answeringRenderer(answers ?? {}, calls),
  });
  const writes = sent.filter((request) => request.method !== "GET");
  const error = json ? ((result.json as { error?: { message: string } } | undefined)?.error?.message ?? "") : said(calls, "error").join("\n");
  return { result, calls, writes, error };
}

function appDir(dependencies: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-create-app-"));
  const root = path.join(dir, "Acme");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "acme", dependencies }));
  return root;
}

test("create without the identifier it needs says how to call it", async () => {
  const { error, writes } = await create(entitlements, {});
  assert.match(error, /Usage: superwall entitlements create --identifier <identifier>/);
  assert.deepEqual(writes, []);

  const campaign = await create(campaigns, {});
  assert.match(campaign.error, /Usage: superwall campaigns create --description "<description>" --placement <placement>$/);

  const unplaced = await create(campaigns, { description: "Upsell", app: "10" });
  assert.match(unplaced.error, /campaigns need at least one placement/);
  assert.deepEqual(unplaced.writes, []);
});

test("an entitlement is created in the project and named with its id", async () => {
  const { calls, writes } = await create(entitlements, { identifier: "pro", project: "1" }, {
    "POST /v2/entitlements": { id: "e1", identifier: "pro" },
  });
  assert.deepEqual(writes, [{ method: "POST", path: "/v2/entitlements", body: { project_id: "1", identifier: "pro" } }]);
  assert.deepEqual(said(calls, "success"), ["Created entitlement `pro` e1"]);
});

test("an entitlement is created on the app --app names, even when another app comes first", async () => {
  const lab = {
    ...PROJECT,
    applications: [
      { id: "20", name: "Lab Android", platform: "android" },
      { id: "10", name: "Lab iOS", platform: "ios" },
    ],
  };
  const { writes } = await create(entitlements, { identifier: "pro", app: "20" }, {
    "GET /v2/projects": [lab],
    "POST /v2/entitlements": { id: "5", identifier: "pro" },
  });
  assert.deepEqual(writes, [
    { method: "POST", path: "/v2/entitlements", body: { project_id: "1", application_id: "20", identifier: "pro" } },
  ]);

  const plan = await create(entitlements, { identifier: "pro", app: "20", dryRun: true }, { "GET /v2/projects": [lab] });
  assert.deepEqual(said(plan.calls, "info"), ['[dry-run] would create entitlement "pro" in Lab, app 20']);
  assert.deepEqual(plan.writes, []);
});

test("a product carries its price in minor units, its period and the entitlements it grants", async () => {
  const { result, writes } = await create(
    products,
    {
      identifier: "pro_monthly",
      project: "1",
      name: "Pro",
      price: "9.99",
      currency: "eur",
      period: "month",
      periodCount: "3",
      trialDays: "7",
      entitlement: ["pro", "plus"],
    },
    { ...ENTITLEMENTS, "POST /v2/products": { id: "p1", identifier: "pro_monthly" } },
    { json: true },
  );
  assert.deepEqual(writes[0]?.body, {
    project_id: "1",
    identifier: "pro_monthly",
    name: "Pro",
    price: { amount: 999, currency: "EUR" },
    subscription: { period: "month", period_count: 3, trial_period_days: 7 },
    application_id: "10",
    entitlements: ["5", "6"],
  });
  assert.deepEqual(result.json, { id: "p1", identifier: "pro_monthly" });
});

test("a product's currency defaults to USD, its period count to one, and one entitlement is a list", async () => {
  const { writes } = await create(
    products,
    { identifier: "pro_weekly", project: "1", price: 2, period: "week", entitlement: "pro" },
    { ...ENTITLEMENTS, "POST /v2/products": { id: "p2" } },
    { json: true },
  );
  assert.deepEqual(writes[0]?.body, {
    project_id: "1",
    identifier: "pro_weekly",
    price: { amount: 200, currency: "USD" },
    subscription: { period: "week", period_count: 1 },
    application_id: "10",
    entitlements: ["5"],
  });
});

test("an entitlement on an app listed after another is granted, and the product goes to that app", async () => {
  const { writes, error } = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["5"] }, splitRoutes([
    { id: 5, identifier: "pro", application_id: 20 },
  ]));
  assert.equal(error, "");
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/v2/products",
      body: { project_id: "1", application_id: "20", identifier: "pro_monthly", entitlements: ["5"] },
    },
  ]);
});

test("an entitlement identifier resolves to its id, preferring the product's own app", async () => {
  const routes = splitRoutes([
    { id: 5, identifier: "pro", application_id: 20 },
    { id: 7, identifier: "pro", application_id: 10 },
    { id: 8, identifier: "plus", application_id: 20 },
  ]);
  const ios = await create(products, { identifier: "pro_monthly", app: "10", entitlement: ["pro", "7"] }, routes);
  assert.deepEqual(ios.writes[0]?.body, {
    project_id: "1",
    application_id: "10",
    identifier: "pro_monthly",
    entitlements: ["7"],
  });

  const inferred = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["pro", "plus"] }, routes);
  assert.deepEqual(inferred.writes[0]?.body, {
    project_id: "1",
    application_id: "20",
    identifier: "pro_monthly",
    entitlements: ["5", "8"],
  });
});

test("a web product grants entitlements of any iOS or Android app, but not of a web app", async () => {
  const routes = splitRoutes([
    { id: 5, identifier: "pro", application_id: 20 },
    { id: 7, identifier: "plus", application_id: 10 },
    { id: 9, identifier: "web_only", application_id: 30 },
  ]);
  const granted = await create(products, { identifier: "pro_web", app: "30", entitlement: ["pro", "plus"] }, routes);
  assert.deepEqual(granted.writes[0]?.body, {
    project_id: "1",
    application_id: "30",
    identifier: "pro_web",
    entitlements: ["5", "7"],
  });

  const refused = await create(products, { identifier: "pro_web", app: "30", entitlement: ["web_only"] }, routes);
  assert.equal(
    refused.error,
    "Entitlement 9 (web_only) is on Lab Web (Stripe) - Lab Web (Stripe) products grant only iOS or Android entitlements: superwall entitlements create --identifier web_only --app <ios or android app>",
  );
  assert.deepEqual(refused.writes, []);
});

test("an entitlement on another app than the product's is refused before anything is sent", async () => {
  const { writes, error } = await create(products, { identifier: "pro_monthly", app: "10", entitlement: ["5"] }, splitRoutes([
    { id: 5, identifier: "pro", application_id: 20 },
  ]));
  assert.equal(
    error,
    "Entitlement 5 (pro) is on Lab Android (Android), not Lab iOS (iOS) - pass --app 20 to create the product there, or create it on Lab iOS: superwall entitlements create --identifier pro --app 10",
  );
  assert.deepEqual(writes, []);
});

test("entitlements no single app can grant are refused, naming where each one is", async () => {
  const { writes, error } = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["5", "7"] }, splitRoutes([
    { id: 5, identifier: "pro", application_id: 20 },
    { id: 7, identifier: "plus", application_id: 10 },
  ]));
  assert.match(error, /^No app of Lab can grant all of these entitlements: 5 \(pro\) is on Lab Android \(Android\); 7 \(plus\) is on Lab iOS \(iOS\)\. /);
  assert.match(error, /pass --app <id>/);
  assert.deepEqual(writes, []);
});

test("an entitlement the project doesn't have is refused with the command that creates it", async () => {
  const { writes, error } = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["gold"] }, ENTITLEMENTS);
  assert.equal(
    error,
    'Lab has no entitlement "gold" - create it first: superwall entitlements create --identifier gold --app <app>',
  );
  assert.deepEqual(writes, []);
});

test("entitlements that can't be listed fail the create instead of reading as none", async () => {
  const { writes, error } = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["5"] }, {
    "GET /v2/projects/1": PROJECT,
    "GET /v2/entitlements?project_id=1": new ApiError("GET /v2/entitlements", 500, "boom"),
  });
  assert.notEqual(error, "");
  assert.doesNotMatch(error, /has no entitlement/);
  assert.deepEqual(writes, []);
});

test("the same entitlement named twice is sent once", async () => {
  const { writes } = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["5", "pro"] }, ENTITLEMENTS);
  assert.deepEqual((writes[0]?.body as { entitlements?: string[] }).entitlements, ["5"]);
});

test("a product dry run shows the app and the entitlement ids it would send", async () => {
  const routes = splitRoutes([{ id: 5, identifier: "pro", application_id: 20 }]);
  const text = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["pro"], dryRun: true }, routes);
  assert.deepEqual(said(text.calls, "info"), ['[dry-run] would create product "pro_monthly" in Lab Android (Android) granting entitlement 5']);
  assert.deepEqual(text.writes, []);

  const plan = await create(products, { identifier: "pro_monthly", project: "1", entitlement: ["pro"], dryRun: true }, routes, { json: true });
  assert.deepEqual(plan.result.json, {
    dryRun: true,
    action: "create",
    resource: "products",
    value: "pro_monthly",
    scope: { projectId: "1", projectName: "Lab", applicationId: "20" },
    entitlements: ["5"],
  });
});

test("a campaign is created in the app with its first placement", async () => {
  const { calls, writes } = await create(
    campaigns,
    { description: "Upsell", placement: "onboarding", app: "10" },
    { "POST /v2/campaigns": { id: 77, description: "Upsell" } },
  );
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/v2/campaigns",
      body: {
        application_id: "10",
        description: "Upsell",
        placements: [{ event_name: "onboarding" }],
        audiences: [{ variants: [{ type: "holdout", percentage: 100, paywall: null }] }],
      },
    },
  ]);
  assert.deepEqual(said(calls, "success"), ["Created campaign `Upsell` 77"]);
});

test("a dry run says where it would create, by app for app resources and by project otherwise", async () => {
  const campaign = await create(campaigns, { description: "Upsell", placement: "onboarding", app: "10", dryRun: true });
  assert.deepEqual(said(campaign.calls, "info"), ['[dry-run] would create campaign "Upsell" in Lab (iOS)']);
  assert.deepEqual(campaign.writes, []);

  const product = await create(products, { identifier: "pro", project: "1", dryRun: true });
  assert.deepEqual(said(product.calls, "info"), ['[dry-run] would create product "pro" in Lab']);

  const plan = await create(entitlements, { identifier: "pro", project: "1", dryRun: true }, {}, { json: true });
  assert.deepEqual(plan.result.json, {
    dryRun: true,
    action: "create",
    resource: "entitlements",
    value: "pro",
    scope: { projectId: "1", projectName: "Lab" },
  });
  assert.deepEqual(plan.writes, []);
});

test("a resource with no create of its own refuses rather than guessing", async () => {
  const paywalls = defineResource({
    name: "paywalls",
    summary: "Paywalls",
    operations: [{ name: "create", summary: "Create", effect: "write", handler: "resource", usage: "" }],
    examples: [["paywalls create", "Create"]],
  });
  const { error, writes } = await create(paywalls, { project: "1", app: "10" }, {}, { json: true });
  assert.match(error, /Usage: superwall paywalls create --identifier/);
  assert.deepEqual(writes, []);
});

test("apps create needs a name and a platform outside a terminal", async () => {
  const { error, writes } = await create(apps, { name: "Acme" });
  assert.match(error, /Usage: superwall apps create --name <name> --platform/);
  assert.deepEqual(writes, []);
});

test("apps create --project adds the app there and shows the end of its key", async () => {
  const { calls, writes } = await create(
    apps,
    { name: "Acme", platform: "ios", bundleId: "com.acme.app", project: "1" },
    {
      "POST /v2/projects/1/applications": {
        id: 1,
        name: "Lab",
        applications: [
          { id: 10, name: "Lab", platform: "ios", public_api_key: "pk_old_0000" },
          { id: 11, name: "Acme", platform: "ios", public_api_key: "pk_live_abcd" },
        ],
      },
    },
  );
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/v2/projects/1/applications",
      body: { name: "Acme", platform: "ios", bundle_id: "com.acme.app" },
    },
  ]);
  assert.deepEqual(said(calls, "success"), ["Added `iOS` app `Acme` in `Lab` · `pk_…abcd`"]);
});

test("apps create names the app by platform when the API renamed it, and has no key to show without one", async () => {
  const byPlatform = await create(
    apps,
    { name: "Acme", platform: "android", project: "1" },
    {
      "POST /v2/projects/1/applications": {
        applications: [
          { id: 10, name: "Lab", platform: "ios" },
          { id: 11, name: "acme-android", platform: "android" },
        ],
      },
    },
  );
  assert.deepEqual(said(byPlatform.calls, "success"), ["Added `Android` app `Acme`"]);

  const last = await create(
    apps,
    { name: "Acme", platform: "web", project: "1" },
    { "POST /v2/projects/1/applications": { name: "Lab", applications: [{ id: 12, public_api_key: "pk_web_9876" }] } },
  );
  assert.deepEqual(said(last.calls, "success"), ["Added `Web` app `Acme` in `Lab` · `pk_…9876`"]);
});

test("apps create --json prints the project the app landed in", async () => {
  const saved = { id: 1, name: "Lab", applications: [{ id: 11, name: "Acme", platform: "ios" }] };
  const { result } = await create(
    apps,
    { name: "Acme", platform: "ios", project: "1" },
    { "POST /v2/projects/1/applications": saved },
    { json: true },
  );
  assert.deepEqual(result.json, saved);
});

test("apps create without a project makes one in the only organization first", async () => {
  const { writes } = await create(
    apps,
    { name: "Acme", platform: "ios" },
    {
      "GET /v2/me/organizations": { data: [{ id: 9, name: "Acme Inc" }] },
      "POST /v2/projects": { id: 70, name: "Acme" },
      "POST /v2/projects/70/applications": { id: 70, applications: [] },
    },
  );
  assert.deepEqual(writes, [
    { method: "POST", path: "/v2/projects", body: { name: "Acme", organization_id: 9 } },
    { method: "POST", path: "/v2/projects/70/applications", body: { name: "Acme", platform: "ios" } },
  ]);
});

test("a second app of one platform in a project is refused in plain words", async () => {
  const { error } = await create(
    apps,
    { name: "Acme", platform: "ios", project: "1" },
    { "POST /v2/projects/1/applications": new ApiError("POST /x", 409, "Duplicate entry 'projectId_platform'") },
  );
  assert.equal(error, "Project 1 already has a iOS app - each project allows one app per platform.");
});

test("any other failure adding an app comes through as the API said it", async () => {
  const { error } = await create(
    apps,
    { name: "Acme", platform: "ios", project: "1" },
    { "POST /v2/projects/1/applications": new ApiError("POST /x", 500, '{"message":"boom"}') },
    { json: true },
  );
  assert.equal(error, "boom");
});

test("apps create --dry-run says where the app would go and sends nothing", async () => {
  const fresh = await create(apps, { name: "Acme", platform: "ios", dryRun: true });
  assert.deepEqual(said(fresh.calls, "info"), ['[dry-run] would add iOS app "Acme" to a new project']);

  const existing = await create(apps, { name: "Acme", platform: "flutter", project: "1", dryRun: true });
  assert.deepEqual(said(existing.calls, "info"), ['[dry-run] would add Flutter app "Acme" to project 1']);

  const plan = await create(apps, { name: "Acme", platform: "ios", dryRun: true }, {}, { json: true });
  assert.deepEqual(plan.result.json, {
    dryRun: true,
    action: "create",
    resource: "apps",
    name: "Acme",
    platform: "ios",
    project: null,
  });
  assert.deepEqual([...fresh.writes, ...existing.writes, ...plan.writes], []);
});

test("apps create in a terminal offers the app it detects here", async () => {
  const installDir = appDir({ expo: "51.0.0" });
  const { calls, writes } = await create(
    apps,
    { installDir, project: "1" },
    { "POST /v2/projects/1/applications": { applications: [] } },
    { answers: { confirm: [true] } },
  );
  assert.deepEqual(said(calls, "info"), ["Detected `Expo (React Native)` · `Expo 51.0.0`"]);
  assert.deepEqual(prompted(calls, "confirm"), ["Create `Acme` in Superwall?"]);
  assert.deepEqual(writes[0]?.body, { name: "Acme", platform: "react_native" });
});

test("apps create in a terminal asks the name and platform when the detected app is declined", async () => {
  const installDir = appDir({ expo: "51.0.0" });
  const { calls, writes } = await create(
    apps,
    { installDir, project: "1" },
    { "POST /v2/projects/1/applications": { applications: [] } },
    { answers: { confirm: [false], text: ["  Other  "], select: ["android"] } },
  );
  const text = calls.find((call) => call.method === "text")?.value as { initialValue?: string; validate: (v: string) => string | undefined };
  assert.equal(text.initialValue, "Acme");
  assert.equal(text.validate(" "), "Required");
  assert.equal(text.validate("x"), undefined);
  const select = calls.find((call) => call.method === "select")?.value as { initialValue?: string; options: { label: string }[] };
  assert.equal(select.initialValue, "react_native");
  assert.deepEqual(select.options.map((option) => option.label), ["iOS", "Android", "Flutter", "React Native", "Web"]);
  assert.deepEqual(writes[0]?.body, { name: "Other", platform: "android" });
});

test("apps create in a terminal with no app here asks only what it lacks", async () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-create-empty-"));
  const named = await create(
    apps,
    { installDir, project: "1", name: "Acme" },
    { "POST /v2/projects/1/applications": { applications: [] } },
    { answers: { select: ["ios"] } },
  );
  const select = named.calls.find((call) => call.method === "select")?.value as { initialValue?: string };
  assert.equal(select.initialValue, "ios");
  assert.deepEqual(prompted(named.calls, "text"), []);
  assert.deepEqual(named.writes[0]?.body, { name: "Acme", platform: "ios" });

  const platformed = await create(
    apps,
    { installDir, project: "1", platform: "web" },
    { "POST /v2/projects/1/applications": { applications: [] } },
    { answers: { text: ["Acme Web"] } },
  );
  assert.deepEqual(prompted(platformed.calls, "select"), []);
  assert.deepEqual(platformed.writes[0]?.body, { name: "Acme Web", platform: "web" });
});

test("apps create in a terminal treats a folder it can't scan as no app here", async () => {
  const installDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sw-create-file-")), "not-a-dir");
  fs.writeFileSync(installDir, "");
  const { calls, writes } = await create(
    apps,
    { installDir, project: "1" },
    { "POST /v2/projects/1/applications": { applications: [] } },
    { answers: { text: ["Acme"], select: ["ios"] } },
  );
  assert.deepEqual(prompted(calls, "confirm"), []);
  assert.deepEqual(writes[0]?.body, { name: "Acme", platform: "ios" });
});

test("apps create in a terminal stops at whichever question is dismissed", async () => {
  const installDir = appDir({ expo: "51.0.0" });
  const cases: Answers[] = [{ confirm: [null] }, { confirm: [false], text: [null] }, { confirm: [false], text: ["X"], select: [null] }];
  for (const answers of cases) {
    const { calls, writes } = await create(apps, { installDir, project: "1" }, {}, { answers });
    assert.deepEqual(said(calls, "warn"), ["Cancelled."]);
    assert.deepEqual(writes, []);
  }
});
