import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAppKey } from "@/commands/platform/apple-keys";
import { ApiError } from "@/core/api/client";
import { AppleError } from "@/core/apple/session";
import { ACME, PEM, scenario as appleScenario, type Scenario } from "../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const create = (kind: string | undefined, options: Scenario = {}) =>
  appleScenario("asc", createAppKey, {
    ...options,
    argv: { target: "keys", value: "create", value2: kind, ...options.argv },
  });

const APP = { id: "8", project_id: "5", name: "Acme", bundle_id: "com.acme.app" };
const SAVED_API_KEY = {
  app_store_connect_configuration: { key_id: "OLDKEY0001", issuer_id: "issuer-111", has_private_key: true },
};

test("creates only the App Store Connect API key and saves it on the app", async () => {
  const run = await create("api_key", { argv: { json: true } });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.result.json, {
    status: "created",
    kind: "api_key",
    key_id: "TEAMKEY001",
    detail: null,
    replaced: null,
    team: ACME,
    app: APP,
  });
  assert.deepEqual(run.log, [
    "signIn jane@example.com",
    "iris POST /apiKeys",
    "iris GET /apiKeys/TEAMKEY001",
  ]);
  assert.deepEqual(
    run.requests.filter((request) => request.method !== "GET").map((request) => request.path),
    ["/v2/projects/5/applications/8/integrations/app-store-connect/configuration"],
  );
});

test("creates only the In-App Purchase key, for the app's bundle ID", async () => {
  const run = await create("purchase_key");
  assert.deepEqual(run.said("success"), [
    "In-App Purchase key IAPKEY0001 created and saved on `Acme`.",
  ]);
  assert.deepEqual(run.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.app",
    key_id: "IAPKEY0001",
    issuer_id: "issuer-111",
    private_key: PEM,
  });
  assert.equal(run.wrote("PUT", "/app-store-connect/configuration").length, 0);
});

test("an app that already has the key is left alone, without signing in to Apple", async () => {
  const json = await create("api_key", { api: { saved: SAVED_API_KEY }, argv: { json: true } });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(json.result.json, {
    status: "already_saved",
    kind: "api_key",
    key_id: "OLDKEY0001",
    app: { id: "8", project_id: "5", name: "Acme" },
  });
  assert.deepEqual(json.log, []);
  assert.equal(json.requests.some((request) => request.method !== "GET"), false);

  const human = await create("api_key", { api: { saved: SAVED_API_KEY } });
  assert.match(human.said("success")[0] ?? "", /already has an App Store Connect API key \(OLDKEY0001\)/);
  assert.match(human.said("success")[0] ?? "", /Pass --replace/);

  const other = await create("purchase_key", { api: { saved: SAVED_API_KEY }, argv: { json: true } });
  assert.equal((other.result.json as { status: string }).status, "created");
});

test("--replace creates another key and says which one it took the place of", async () => {
  const run = await create("api_key", {
    api: { saved: SAVED_API_KEY },
    argv: { json: true, replace: true },
  });
  const body = run.result.json as { status: string; key_id: string; replaced: string };
  assert.equal(body.status, "created");
  assert.equal(body.key_id, "TEAMKEY001");
  assert.equal(body.replaced, "OLDKEY0001");
});

test("without prompts it stops for Apple's code and names the command to continue with", async () => {
  const run = await create("purchase_key", { apple: { twoFactor: true }, argv: { json: true } });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run.result.json, {
    status: "verification_required",
    method: "device",
    destination: null,
    next: "superwall asc keys create purchase_key --code <code>",
  });
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
});

test("a refusal from Apple is reported and nothing is saved", async () => {
  const run = await create("api_key", {
    apple: { refuse: { apiKeys: new AppleError("forbidden", "does not allow this request", 403) } },
    argv: { json: true },
  });
  assert.equal(process.exitCode, 1);
  const body = run.result.json as { status: string; key_id: null; detail: string };
  assert.equal(body.status, "failed");
  assert.equal(body.key_id, null);
  assert.match(body.detail, /Only an Admin or the Account Holder can create team keys/);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);

  process.exitCode = undefined;
  const human = await create("purchase_key", {
    apple: { refuse: { subscriptionKeys: new AppleError("request", "Maximum number of keys", 409) } },
  });
  assert.equal(process.exitCode, 1);
  assert.match(human.said("warn")[0] ?? "", /In-App Purchase key: This team is at Apple's limit/);
  assert.deepEqual(human.said("success"), []);
});

test("a created key Superwall cannot save is kept on disk", async () => {
  const run = await create("api_key", {
    api: { failAppSave: new ApiError("PUT /x", 500, '{"message":"boom"}') },
  });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run.files, { "AuthKey_TEAMKEY001.p8": PEM });
});

test("the bundle ID is checked on the signed-in team before a key is created", async () => {
  const run = await create("api_key", {
    apple: { apps: [{ id: "701", attributes: { name: "Other", bundleId: "com.acme.other" } }] },
  });
  assert.equal(process.exitCode, 1);
  assert.match(run.said("error")[0] ?? "", /No App Store Connect app with bundle ID com\.acme\.app/);
  assert.deepEqual(run.log, ["signIn jane@example.com"]);
});

test("--dry-run signs in and checks access to that kind of key only", async () => {
  const run = await create("purchase_key", { argv: { dryRun: true, json: true } });
  assert.deepEqual(run.result.json, {
    dryRun: true,
    kind: "purchase_key",
    team: ACME,
    access: "ok",
  });
  assert.deepEqual(run.log, ["signIn jane@example.com", "iris GET /subscriptionKeys"]);

  const refused = await create("api_key", {
    apple: { refuse: {} },
    argv: { dryRun: true },
  });
  assert.deepEqual(refused.said("report"), ["✓ App Store Connect API key  ok"]);
  assert.deepEqual(refused.said("info").at(-1), "[dry-run] nothing was created or changed.");
});

test("it needs a kind, an existing iOS app, and says which when there are several", async () => {
  const missing = await create(undefined);
  assert.deepEqual(missing.said("error"), [
    "Usage: superwall asc keys create <api_key | purchase_key> --app <id>",
  ]);
  const unknown = await create("team");
  assert.match(unknown.said("error")[0] ?? "", /Usage: superwall asc keys create/);

  const none = await create("api_key", { api: { projects: [{ id: 5, applications: [] }] } });
  assert.match(none.said("error")[0] ?? "", /There's no iOS app in Superwall yet/);
  assert.equal(none.log.length, 0);

  const apps = [
    { id: 8, name: "Acme", platform: "ios", bundle_id: "com.acme.app" },
    { id: 9, name: "Other", platform: "ios", bundle_id: "com.acme.other" },
  ];
  const several = await create("api_key", { api: { projects: [{ id: 5, applications: apps }] } });
  assert.match(several.said("error")[0] ?? "", /Several iOS apps found: 8 \(Acme\), 9 \(Other\)/);

  process.exitCode = undefined;
  const picked = await create("api_key", {
    api: { projects: [{ id: 5, applications: apps }] },
    interactive: true,
    answers: { select: ["8"] },
  });
  assert.deepEqual(picked.said("success"), [
    "App Store Connect API key TEAMKEY001 created and saved on `Acme`.",
  ]);

  const cancelled = await create("api_key", {
    api: { projects: [{ id: 5, applications: apps }] },
    interactive: true,
  });
  assert.deepEqual(cancelled.said("error"), ["Cancelled."]);
});
