import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as setupApple } from "@/commands/app-store-connect/setup/apple";
import { IOS_APP, scenario as appleScenario, type AppleOptions, type Scenario } from "../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const scenario = (options: Scenario = {}) => appleScenario(setupApple, options);

type AppleApps = NonNullable<AppleOptions["apps"]>;

const appleApp = (id: string, bundleId: string, name?: string) =>
  ({ id, attributes: { bundleId, ...(name === undefined ? {} : { name }) } }) as AppleApps[number];

interface Choice {
  value: string;
  label: string;
  hint?: string;
}

function choices(run: Awaited<ReturnType<typeof scenario>>): Choice[][] {
  return run.calls
    .filter((call) => call.method === "select")
    .map((call) => (call.value as { options: Choice[] }).options);
}

const OTHER = { id: 9, name: "Other", platform: "ios", bundle_id: "com.acme.other" };

test("apps on other platforms, or with none, are not iOS apps, and a new app needs a project", async () => {
  const run = await scenario({
    api: {
      projects: [
        { id: 5, applications: [{ id: 3, name: "Droid", platform: "android" }, { id: 4, name: "Mystery" }] },
        { id: 6, name: "Empty" },
      ],
    },
    flags: { bundleId: "com.acme.app" },
  });

  assert.deepEqual(run.said("error"), ["Several projects found: 5 (unnamed), 6 (Empty). Pass --project <id>."]);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
});

test("an unnamed app is listed as unnamed when there are several", async () => {
  const run = await scenario({
    api: { projects: [{ id: 5, applications: [IOS_APP, { id: 9, platform: "ios" }] }] },
  });

  assert.deepEqual(run.said("error"), ["Several iOS apps found: 8 (Acme), 9 (unnamed). Pass --app <id>."]);
});

test("the app picker labels each app by name or id, hinted by bundle ID or project", async () => {
  const run = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: [IOS_APP, { id: 9, platform: "ios" }] }] },
    interactive: true,
    answers: { select: [null] },
  });

  assert.deepEqual(choices(run)[0], [
    { value: "8", label: "Acme", hint: "com.acme.app" },
    { value: "9", label: "9", hint: "Main" },
    { value: "__new__", label: "Create a new iOS app" },
  ]);
  assert.deepEqual(run.said("error"), ["Cancelled."]);
});

test("--bundle-id picks the matching app among several, or creates a new one beside them", async () => {
  const projects = [{ id: 5, name: "Main", applications: [IOS_APP, OTHER] }];

  const matched = await scenario({
    apple: { apps: [appleApp("777", "com.acme.other", "Other")] },
    api: { projects },
    json: true,
    flags: { bundleId: "com.acme.other", skipApiKey: true, skipPurchaseKey: true, skipNotificationUrl: true },
  });
  assert.deepEqual((matched.result.json as { app: unknown }).app, {
    id: "9",
    project_id: "5",
    name: "Other",
    bundle_id: "com.acme.other",
    created: false,
  });

  const created = await scenario({
    apple: { apps: [appleApp("778", "com.acme.new", "New")] },
    api: { projects },
    json: true,
    flags: { bundleId: "com.acme.new", skipApiKey: true, skipPurchaseKey: true, skipNotificationUrl: true },
  });
  assert.deepEqual(created.wrote("POST", "/v2/projects/5/applications")[0]?.body, {
    name: "New",
    platform: "ios",
    bundle_id: "com.acme.new",
  });
  assert.equal((created.result.json as { app: { created: boolean } }).app.created, true);
});

test("a missing bundle ID lists at most eight of the team's apps", async () => {
  const apps = Array.from({ length: 11 }, (_, index) => appleApp(String(700 + index), `com.acme.app${index}`, `App ${index}`));
  const run = await scenario({ apple: { apps } });

  const [error] = run.said("error");
  assert.match(error ?? "", /This team's apps: com\.acme\.app0, .*com\.acme\.app7, and 3 more\./);
  assert.doesNotMatch(error ?? "", /com\.acme\.app8/);
});

test("the App Store Connect picker labels an unnamed app by its bundle ID and can be cancelled", async () => {
  const run = await scenario({
    apple: { apps: [appleApp("555", "com.acme.app", "Acme"), appleApp("556", "com.acme.widget")] },
    api: { projects: [{ id: 5, name: "Main", applications: [{ id: 8, name: "Acme", platform: "ios" }] }] },
    interactive: true,
    answers: { select: ["8", null] },
  });

  assert.deepEqual(choices(run)[1], [
    { value: "555", label: "Acme", hint: "com.acme.app" },
    { value: "556", label: "com.acme.widget", hint: "com.acme.widget" },
  ]);
  assert.deepEqual(run.said("error"), ["Cancelled."]);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
});

test("the project picker labels an unnamed project by id and can be cancelled", async () => {
  const run = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: [IOS_APP] }, { id: 6 }] },
    interactive: true,
    answers: { select: ["__new__", "555", null] },
  });

  assert.deepEqual(choices(run)[2], [
    { value: "5", label: "Main" },
    { value: "6", label: "6" },
  ]);
  assert.deepEqual(run.said("error"), ["Cancelled."]);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
});

test("an unnamed Superwall app goes by its id, and an unnamed Apple app by its bundle ID", async () => {
  const existing = await scenario({
    api: { projects: [{ id: 5, applications: [{ id: 8, platform: "ios", bundle_id: "com.acme.app" }] }] },
    json: true,
    flags: { skipApiKey: true, skipPurchaseKey: true, skipNotificationUrl: true },
  });
  assert.equal((existing.result.json as { app: { name: string } }).app.name, "8");

  const created = await scenario({
    apple: { apps: [appleApp("556", "com.acme.app")] },
    api: { projects: [{ id: 5, applications: [] }] },
    json: true,
    flags: { bundleId: "com.acme.app", skipApiKey: true, skipPurchaseKey: true, skipNotificationUrl: true },
  });
  assert.deepEqual(created.wrote("POST", "/v2/projects/5/applications")[0]?.body, {
    name: "com.acme.app",
    platform: "ios",
    bundle_id: "com.acme.app",
  });
});

test("a created app missing from an answer without applications stops before Apple is touched", async () => {
  const run = await scenario({
    api: {
      projects: [{ id: 5, applications: [] }],
      routes: (method, path) => (method === "POST" && path === "/v2/projects/5/applications" ? { id: 5 } : undefined),
    },
    flags: { bundleId: "com.acme.app" },
  });

  assert.match(run.said("error")[0] ?? "", /^Superwall created Acme but didn't return it\./);
  assert.deepEqual(run.log, ["signIn jane@example.com"]);
});
