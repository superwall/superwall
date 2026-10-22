import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { command as importKeys } from "@/commands/app-store-connect/keys/import";
import { command as list } from "@/commands/app-store-connect/keys/list";
import { command as keySources } from "@/commands/app-store-connect/keys/sources";
import { runWithApi as keys, scenario } from "../../../helpers/apple-setup";

const DIR = mkdtempSync(join(tmpdir(), "superwall-saved-keys-"));
const KEY_FILE = join(DIR, "AuthKey.p8");
writeFileSync(KEY_FILE, "PEM");
const ORG_KEYS = "/v2/organizations/9/app-store-connect";

after(() => {
  rmSync(DIR, { recursive: true, force: true });
});

afterEach(() => {
  process.exitCode = undefined;
});

const orgKeys = (configs: unknown[], created: unknown = { team_id: "TEAM1" }) => ({
  routes: (method: string, path: string) => {
    if (path !== ORG_KEYS) return undefined;
    return method === "GET" ? { data: configs } : created;
  },
});

test("an organization's keys are counted and named by team, or by id", async () => {
  const one = await keys(list, {}, orgKeys([{ id: "cfg-1", name: "Primary", team_id: "TEAM1" }]));
  assert.deepEqual(one.said("step"), ["1 App Store Connect credential"]);
  assert.deepEqual(one.said("info"), ["`Primary`  TEAM1"]);

  const two = await keys(list, {}, orgKeys([{ id: "cfg-1", name: "Primary" }, { name: "Spare" }]));
  assert.deepEqual(two.said("step"), ["2 App Store Connect credentials"]);
  assert.deepEqual(two.said("info"), ["`Primary`  cfg-1", "`Spare`  "]);
});

test("with no organization key it says how to add one, and offers to when it can ask", async () => {
  const told = await keys(list, {}, orgKeys([]));
  assert.deepEqual(told.said("step"), ["No App Store Connect credentials yet"]);
  assert.deepEqual(told.said("info"), [
    "Add one: superwall asc keys create --key-id <id> --issuer <id> --key-file <path.p8>",
  ]);

  const declined = await keys(list, {}, { ...orgKeys([]), interactive: true, confirm: false });
  assert.deepEqual(declined.said("info"), []);
  assert.equal(declined.wrote("POST", ORG_KEYS).length, 0);
});

test("accepting the offer walks through connecting a key", async () => {
  const run = await scenario(list, {
    interactive: true,
    answers: { confirm: [true], text: ["K5", "I5", KEY_FILE, ""] },
    api: orgKeys([], { team_id: "TEAM5" }),
  });

  assert.deepEqual(run.wrote("POST", ORG_KEYS)[0]?.body, {
    key_id: "K5",
    issuer_id: "I5",
    private_key: "PEM",
    account_name: "App Store Connect",
  });
  assert.deepEqual(run.said("success"), ["App Store Connect connected TEAM5"]);
});

test("an app's saved In-App Purchase key shows the bundle ID it was saved for", async () => {
  const run = await keys(list, { json: true, flags: { app: "8" } }, {
    saved: {
      in_app_purchase_configuration: {
        key_id: "IAPKEY0001",
        issuer_id: "issuer-1",
        has_private_key: true,
        bundle_id: "com.acme.app",
      },
    },
  });

  assert.deepEqual(run.json(), {
    application_id: "8",
    api_key: null,
    purchase_key: { key_id: "IAPKEY0001", issuer_id: "issuer-1", bundle_id: "com.acme.app" },
  });
});

test("an app outside the listed projects is reached by id, as every other command reaches it", async () => {
  const elsewhere = (platform: string) => ({
    routes: (_method: string, path: string) => {
      if (path === "/v2/paywalls?application_id=42&limit=1") return { data: [{ project_id: 77 }] };
      if (path === "/v2/projects/77") {
        return { id: 77, organization_id: 12, applications: [{ id: 42, name: "Elsewhere", platform }] };
      }
      return undefined;
    },
  });

  const ios = await keys(list, { json: true, flags: { app: "42" } }, elsewhere("ios"));
  assert.deepEqual(ios.json(), { application_id: "42", api_key: null, purchase_key: null });

  const android = await keys(list, { json: true, flags: { app: "42" } }, elsewhere("android"));
  assert.deepEqual(android.json(), {
    error: { code: "command_error", message: "No iOS app 42 in this organization." },
  });

  const otherProject = await keys(list, { json: true, flags: { app: "42", project: "5" } }, elsewhere("ios"));
  assert.deepEqual(otherProject.json(), {
    error: { code: "command_error", message: "No iOS app 42 in this organization." },
  });
});

test("an import without a key id or source name still reads as a sentence", async () => {
  const answer = (status: string) => ({
    routes: (method: string, path: string) =>
      method === "POST" && path.endsWith("/app-store-keys/import")
        ? {
            kind: "api_key",
            status,
            key_id: null,
            source_name: null,
            source_application_id: null,
            tried: 1,
            timed_out: false,
          }
        : undefined,
  });
  const input = { args: { kind: "api_key" }, flags: { app: "8" } };

  const imported = await keys(importKeys, input, answer("imported"));
  const kept = await keys(importKeys, input, answer("already_saved"));

  assert.deepEqual(imported.said("report"), ["✓ App Store Connect API key  imported to Acme."]);
  assert.deepEqual(kept.said("report"), [
    "✓ Acme already has an App Store Connect API key. It was left as it is.",
  ]);
});

test("a copy refused without a reason says it wasn't copied", async () => {
  const run = await keys(importKeys, { args: { kind: "api_key" }, flags: { app: "8", from: "12" } }, {
    routes: (_method, path) =>
      path.endsWith("/app-store-keys/copy")
        ? { kind: "api_key", valid: false, error: null, unconfirmed: null }
        : undefined,
  });

  assert.deepEqual(run.said("error"), ["The key wasn't copied.\nNothing was saved."]);
  assert.equal(process.exitCode, 1);
});

test("keys on other apps are counted in the plural", async () => {
  const run = await keys(keySources, { flags: { app: "8" } }, {
    routes: (method, path) =>
      method === "GET" && path.endsWith("/app-store-keys/copy-sources")
        ? {
            api_key: [{ application_id: "12", name: "Other App", key_id: "APIKEY0001", others_count: 0 }],
            purchase_key: [{ application_id: "12", name: "Other App", key_id: "IAPKEY0001", others_count: 0 }],
          }
        : undefined,
  });

  assert.deepEqual(run.said("step"), ["2 keys on your other apps"]);
});

test("one key on another app is counted in the singular, without others", async () => {
  const run = await keys(keySources, { flags: { app: "8" } }, {
    routes: (method, path) =>
      method === "GET" && path.endsWith("/app-store-keys/copy-sources")
        ? {
            api_key: [],
            purchase_key: [{ application_id: "12", name: "Other App", key_id: "IAPKEY0001", others_count: 0 }],
          }
        : undefined,
  });

  assert.deepEqual(run.said("step"), ["1 key on your other apps"]);
  assert.deepEqual(run.said("info"), ["`IAPKEY0001`  In-App Purchase key  from Other App (app 12)"]);
});
