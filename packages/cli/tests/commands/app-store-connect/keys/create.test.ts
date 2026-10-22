import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { command as create } from "@/commands/app-store-connect/keys/create";
import { ApiError } from "@/core/api/client";
import { AppleError } from "@/core/app-store-connect/apple-web/session";
import { ACME, PEM, scenario as appleScenario, runWithApi as keys, type Scenario } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const KEY_FILE = join(mkdtempSync(join(tmpdir(), "superwall-keys-")), "AuthKey.p8");
writeFileSync(KEY_FILE, "PEM");
const HELD = { keyId: "K1", issuer: "I1", keyFile: KEY_FILE };

test("keys create --key-file --app saves a key file on the app, and a rejected key exits non-zero", async () => {
  const api = await keys(create, { json: true, flags: { app: "8", ...HELD } });
  assert.deepEqual(api.json(), {
    application_id: "8",
    kind: "api_key",
    key_id: "K1",
    valid: true,
    error: null,
  });
  assert.deepEqual(api.wrote("PUT", "/app-store-connect/configuration")[0]?.body, {
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
  });

  const purchase = await keys(create, { args: { kind: "purchase_key" }, flags: { app: "8", ...HELD } },
    { purchaseVerdict: { valid: false, error: "Invalid key" } },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(purchase.said("error"), ["Apple didn't accept In-App Purchase key K1: Invalid key"]);
  assert.deepEqual(purchase.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.app",
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
  });

  process.exitCode = undefined;
  const saved = await keys(create, { args: { kind: "purchase_key" }, flags: { app: "8", ...HELD } });
  assert.deepEqual(saved.said("success"), ["In-App Purchase key K1 saved on `Acme`."]);

  const bare = await keys(create, { args: { kind: "purchase_key" }, flags: { app: "8", ...HELD } },
    { projects: [{ id: 5, applications: [{ id: 8, name: "Acme", platform: "ios" }] }] },
  );
  assert.deepEqual(bare.said("error"), [
    "`Acme` has no bundle ID in Superwall. Pass --bundle-id <id> to save it with the key, or set it first with `superwall apps update 8 --bundle-id <id>`.",
  ]);
  assert.equal(bare.wrote("PUT", "").length, 0);

  const wrongKind = await keys(create, { args: { kind: "team" }, flags: { app: "8", ...HELD } });
  assert.deepEqual(wrongKind.said("error"), ['<kind> is one of: api_key, purchase_key (not "team").']);
  assert.equal(wrongKind.wrote("PUT", "").length, 0);
});

test("keys create purchase_key --key-file keeps the key and the app on one bundle ID", async () => {
  const noBundle = { projects: [{ id: 5, applications: [{ id: 8, name: "Acme", platform: "ios" }] }] };

  const both = await keys(create, { args: { kind: "purchase_key" }, flags: { app: "8", bundleId: "com.acme.app", ...HELD } },
    noBundle,
  );
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(both.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.app",
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
    set_application_bundle_id: true,
  });
  assert.deepEqual(both.said("success"), [
    "In-App Purchase key K1 and the bundle ID com.acme.app saved on `Acme`.",
  ]);

  const same = await keys(create, { json: true, args: { kind: "purchase_key" }, flags: { app: "8", bundleId: "com.acme.app", ...HELD } });
  assert.deepEqual(same.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.app",
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
  });
  assert.equal((same.json() as { bundle_id_saved: boolean }).bundle_id_saved, false);

  const other = await keys(create, { args: { kind: "purchase_key" }, flags: { app: "8", bundleId: "com.acme.other", ...HELD } });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(other.said("error"), [
    "`Acme` has the bundle ID com.acme.app in Superwall, not com.acme.other. Nothing was created or saved. To change it, run `superwall apps update 8 --bundle-id com.acme.other` first, once a person has agreed.",
  ]);
  assert.equal(other.wrote("PUT", "").length, 0);
});

test("keys create purchase_key --key-file warns before a new bundle ID puts reported builds in test mode", async () => {
  const run1 = await keys(create, { args: { kind: "purchase_key" }, flags: { app: "8", bundleId: "com.acme.app", ...HELD } },
    {
      projects: [{ id: 5, applications: [{ id: 8, name: "Acme", platform: "ios" }] }],
      candidates: [
        {
          bundle_id: "com.acme.lite",
          production_devices: 40,
          sandbox_devices: 0,
          last_seen_at: "2026-10-10T00:00:00Z",
          top_country: null,
        },
      ],
    },
  );
  assert.deepEqual(run1.said("warn"), [
    "Saving the bundle ID com.acme.app: 40 production devices in the last 30 days used com.acme.lite, and would run in test mode.",
  ]);
});

test("--dry-run plans saving a held key without making it", async () => {
  const input = { flags: { ...HELD, app: "8", dryRun: true } };
  const human = await keys(create, input);
  assert.match(human.said("info")[0] ?? "", /^\[dry-run\] would /);
  assert.equal(human.requests.length, 0);
  const json = await keys(create, { ...input, json: true });
  assert.equal((json.json() as { dryRun: boolean }).dryRun, true);
});

test("a held key without --app becomes the organization's key", async () => {
  const routes = (_method: string, path: string) =>
    path.startsWith("/v2/organizations/9/app-store-connect") ? { team_id: "TEAM1" } : undefined;
  const created = await keys(create, { json: true, flags: HELD }, { routes });
  assert.deepEqual(created.wrote("POST", "/app-store-connect")[0]?.body, {
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
    account_name: "App Store Connect",
  });
  const team = await keys(create, { flags: { ...HELD, team: "TEAM1" } }, { routes });
  assert.deepEqual(team.said("error"), [
    "To replace a team's key, run `superwall asc keys update --team <team id> ...`.",
  ]);
});

const signIn = (kind: string | undefined, options: Scenario = {}) =>
  appleScenario(create, { ...options, args: { kind, ...options.args } });

const APP = { id: "8", project_id: "5", name: "Acme", bundle_id: "com.acme.app" };
const SAVED_API_KEY = {
  app_store_connect_configuration: { key_id: "OLDKEY0001", issuer_id: "issuer-111", has_private_key: true },
};

test("creates only the App Store Connect API key and saves it on the app", async () => {
  const run = await signIn("api_key", { json: true });
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
  const run = await signIn("purchase_key");
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
  const json = await signIn("api_key", { api: { saved: SAVED_API_KEY }, json: true });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(json.result.json, {
    status: "already_saved",
    kind: "api_key",
    key_id: "OLDKEY0001",
    app: { id: "8", project_id: "5", name: "Acme" },
  });
  assert.deepEqual(json.log, []);
  assert.equal(json.requests.some((request) => request.method !== "GET"), false);

  const human = await signIn("api_key", { api: { saved: SAVED_API_KEY } });
  assert.match(human.said("success")[0] ?? "", /already has an App Store Connect API key \(OLDKEY0001\)/);
  assert.match(human.said("success")[0] ?? "", /Pass --replace/);

  const other = await signIn("purchase_key", { api: { saved: SAVED_API_KEY }, json: true });
  assert.equal((other.result.json as { status: string }).status, "created");
});

test("--replace creates another key and says which one it took the place of", async () => {
  const run = await signIn("api_key", {
    api: { saved: SAVED_API_KEY },
    json: true, flags: { replace: true },
  });
  const body = run.result.json as { status: string; key_id: string; replaced: string };
  assert.equal(body.status, "created");
  assert.equal(body.key_id, "TEAMKEY001");
  assert.equal(body.replaced, "OLDKEY0001");
});

test("without prompts it stops for Apple's code and names the command to continue with", async () => {
  const run = await signIn("purchase_key", { apple: { twoFactor: true }, json: true });
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
  const run = await signIn("api_key", {
    apple: { refuse: { apiKeys: new AppleError("forbidden", "does not allow this request", 403) } },
    json: true,
  });
  assert.equal(process.exitCode, 1);
  const body = run.result.json as { status: string; key_id: null; detail: string };
  assert.equal(body.status, "failed");
  assert.equal(body.key_id, null);
  assert.match(body.detail, /Only an Admin or the Account Holder can create team keys/);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);

  process.exitCode = undefined;
  const human = await signIn("purchase_key", {
    apple: { refuse: { subscriptionKeys: new AppleError("request", "Maximum number of keys", 409) } },
  });
  assert.equal(process.exitCode, 1);
  assert.match(human.said("warn")[0] ?? "", /In-App Purchase key: This team is at Apple's limit/);
  assert.deepEqual(human.said("success"), []);
});

test("a created key Superwall cannot save is kept on disk", async () => {
  const run = await signIn("api_key", {
    api: { failAppSave: new ApiError("PUT /x", 500, '{"message":"boom"}') },
  });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run.files, { "AuthKey_TEAMKEY001.p8": PEM });
});

test("the bundle ID is checked on the signed-in team before a key is created", async () => {
  const run = await signIn("api_key", {
    apple: { apps: [{ id: "701", attributes: { name: "Other", bundleId: "com.acme.other" } }] },
  });
  assert.equal(process.exitCode, 1);
  assert.match(run.said("error")[0] ?? "", /No App Store Connect app with bundle ID com\.acme\.app/);
  assert.deepEqual(run.log, ["signIn jane@example.com"]);
});

test("--dry-run signs in and checks access to that kind of key only", async () => {
  const run = await signIn("purchase_key", { json: true, flags: { dryRun: true } });
  assert.deepEqual(run.result.json, {
    dryRun: true,
    kind: "purchase_key",
    team: ACME,
    access: "ok",
  });
  assert.deepEqual(run.log, ["signIn jane@example.com", "iris GET /subscriptionKeys"]);

  const refused = await signIn("api_key", {
    apple: { refuse: {} },
    flags: { dryRun: true },
  });
  assert.deepEqual(refused.said("report"), ["✓ App Store Connect API key  ok"]);
  assert.deepEqual(refused.said("info").at(-1), "[dry-run] nothing was created or changed.");
});

test("it needs a kind, an existing iOS app, and says which when there are several", async () => {
  const missing = await signIn(undefined);
  assert.deepEqual(missing.said("error"), [
    "Usage: superwall asc keys create <api_key | purchase_key> --app <id>",
  ]);
  const unknown = await signIn("team");
  assert.deepEqual(unknown.said("error"), ['<kind> is one of: api_key, purchase_key (not "team").']);

  const none = await signIn("api_key", { api: { projects: [{ id: 5, applications: [] }] } });
  assert.match(none.said("error")[0] ?? "", /There's no iOS app in Superwall yet/);
  assert.equal(none.log.length, 0);

  const apps = [
    { id: 8, name: "Acme", platform: "ios", bundle_id: "com.acme.app" },
    { id: 9, name: "Other", platform: "ios", bundle_id: "com.acme.other" },
  ];
  const several = await signIn("api_key", { api: { projects: [{ id: 5, applications: apps }] } });
  assert.match(several.said("error")[0] ?? "", /Several iOS apps found: 8 \(Acme\), 9 \(Other\)/);

  process.exitCode = undefined;
  const picked = await signIn("api_key", {
    api: { projects: [{ id: 5, applications: apps }] },
    interactive: true,
    answers: { select: ["8"] },
  });
  assert.deepEqual(picked.said("success"), [
    "App Store Connect API key TEAMKEY001 created and saved on `Acme`.",
  ]);

  const cancelled = await signIn("api_key", {
    api: { projects: [{ id: 5, applications: apps }] },
    interactive: true,
  });
  assert.deepEqual(cancelled.said("error"), ["Cancelled."]);
});
