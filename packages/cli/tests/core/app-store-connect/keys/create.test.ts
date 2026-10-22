import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as create } from "@/commands/app-store-connect/keys/create";
import { command as list } from "@/commands/app-store-connect/keys/list";
import { ApiError } from "@/core/api/client";
import { keyRole } from "@/core/app-store-connect/keys/create";
import { keyKind } from "@/core/api/integrations";
import { createAppleSession } from "@/core/app-store-connect/apple-web/session";
import { fakeApple, fixedRandom, jsonResponse, vector, type FakeAppleOptions } from "../../../helpers/apple";
import { PEM, fakeApi, scenario, useAppleDeps, type ApiOptions } from "../../../helpers/apple-setup";
import { runCommand } from "../../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

test("keyRole reads the role a person typed, app_manager when none", () => {
  assert.equal(keyRole(undefined), "APP_MANAGER");
  assert.equal(keyRole("app-manager"), "APP_MANAGER");
  assert.equal(keyRole("Admin"), "ADMIN");
  assert.throws(() => keyRole("finance"), { message: "--key-role must be app_manager or admin." });
});

test("keyKind knows the two kinds of app key and nothing else", () => {
  assert.equal(keyKind("api_key"), "api_key");
  assert.equal(keyKind("purchase_key"), "purchase_key");
  assert.equal(keyKind("team"), undefined);
  assert.equal(keyKind(undefined), undefined);
});

const UNNAMED = { projects: [{ id: 5, name: "Main", applications: [{ id: 8, platform: "ios", bundle_id: "com.acme.app" }] }] };
const NO_BUNDLE = { projects: [{ id: 5, name: "Main", applications: [{ id: 8, name: "Acme", platform: "ios" }] }] };
const REFUSED =
  "Apple refused. Only an Admin or the Account Holder can create team keys, and the team's agreements must be signed at https://appstoreconnect.apple.com/agreements.";

afterEach(() => {
  process.exitCode = undefined;
});

async function againstApple(
  apple: FakeAppleOptions,
  input: { args?: Record<string, unknown>; flags?: Record<string, unknown>; json?: boolean },
  options: ApiOptions = {},
) {
  const fake = fakeApple({ twoFactor: false, ...apple });
  const { api, requests } = fakeApi(options);
  const calls: RendererCall[] = [];
  const files: string[] = [];
  const restore = useAppleDeps({
    session: (sessionOptions) => createAppleSession({ fetch: fake.fetch, random: fixedRandom, ...sessionOptions }),
    credentials: () => ({ appleId: vector.accountName, password: vector.password }),
    pending: { load: () => undefined, save: () => {}, clear: () => {} },
    sleep: async () => {},
    writeKeyFile: (name) => {
      files.push(name);
      return `/tmp/${name}`;
    },
  });
  try {
    const result = await runCommand(create, { ...input, api, renderer: recordingRenderer(calls) });
    return {
      result,
      fake,
      files,
      requests,
      said: (method: string) => calls.filter((call) => call.method === method).map((call) => String(call.value)),
    };
  } finally {
    restore();
  }
}

const irisFails = (fragment: string, method = "GET") => (call: { method: string; url: string }) => {
  if (call.method !== method || !call.url.includes(fragment)) return undefined;
  return jsonResponse({ errors: [{ detail: "Forbidden" }] }, { status: 403 });
};

const appleOffline = (fragment: string) => (call: { method: string; url: string }) => {
  if (call.url.includes(fragment)) throw new TypeError("fetch failed");
  return undefined;
};

test("--dry-run reports that this Apple Account may not create the key", async () => {
  const run = await againstApple({ iris: irisFails("/iris/v1/apiKeys") }, {
    args: { kind: "api_key" },
    flags: { dryRun: true },
  });

  assert.deepEqual(run.said("report"), [`✗ App Store Connect API key  ${REFUSED}`]);
  assert.deepEqual(run.said("info").at(-1), "[dry-run] nothing was created or changed.");
  assert.equal(run.fake.called("POST", "/iris/").length, 0);
  assert.equal(process.exitCode, undefined);

  const allowed = await againstApple({}, { args: { kind: "purchase_key" }, flags: { dryRun: true } });
  assert.deepEqual(allowed.said("report"), ["✓ In-App Purchase key  ok"]);
});

test("losing Apple while checking access is an error, not a refusal", async () => {
  const run = await againstApple({ routes: appleOffline("/iris/v1/apiKeys") }, {
    args: { kind: "api_key" },
    flags: { dryRun: true },
  });

  assert.deepEqual(run.said("error"), ["Couldn't reach Apple. Check your network or proxy, then try again."]);
  assert.deepEqual(run.said("report"), []);
  assert.equal(process.exitCode, 1);
});

test("losing Apple while creating a key saves nothing and keeps no file", async () => {
  const acme = { data: [{ id: "555", type: "apps", attributes: { name: "Acme", bundleId: "com.acme.app" } }] };
  const run = await againstApple(
    {
      routes: appleOffline("/iris/v1/apiKeys"),
      iris: (call) => (call.url.includes("/iris/v1/apps") ? jsonResponse(acme) : undefined),
    },
    { args: { kind: "api_key" } },
  );

  assert.deepEqual(run.said("error"), ["Couldn't reach Apple. Check your network or proxy, then try again."]);
  assert.equal(run.requests.filter((request) => request.method === "PUT").length, 0);
  assert.deepEqual(run.files, []);
});

test("a key Superwall keeps refusing while Apple activates it is retried, then kept on disk", async () => {
  const run = await scenario(create, {
    args: { kind: "api_key" },
    api: { failAppSave: new ApiError("PUT /x", 401, '{"message":"Apple rejected the key"}') },
    json: true,
  });

  assert.deepEqual(run.sleeps, [1000, 2000, 3000]);
  assert.equal(run.wrote("PUT", "/app-store-connect/configuration").length, 4);
  assert.deepEqual(run.files, { "AuthKey_TEAMKEY001.p8": PEM });
  assert.match(
    (run.result.json as { detail: string }).detail,
    /^Superwall couldn't save the key: Apple rejected the key\. Apple only releases a key once, so it was saved to \/tmp\/AuthKey_TEAMKEY001\.p8 \(issuer issuer-111\)\.$/,
  );
  assert.equal(process.exitCode, 1);
});

test("a key Apple never accepts, without a reason, is kept on disk", async () => {
  const never = { valid: false, error: null };
  const run = await scenario(create, {
    args: { kind: "api_key" },
    api: { appVerdicts: [never, never, never, never] },
    json: true,
  });

  assert.match((run.result.json as { detail: string }).detail, /^Apple hasn't accepted the new key yet\. Apple only releases/);
  assert.deepEqual(run.files, { "AuthKey_TEAMKEY001.p8": PEM });
});

test("an app without a name is called by its id", async () => {
  const saved = await scenario(create, {
    args: { kind: "api_key" },
    api: {
      ...UNNAMED,
      saved: { app_store_connect_configuration: { key_id: "OLDKEY0001", issuer_id: "issuer-111", has_private_key: true } },
    },
  });
  assert.deepEqual(saved.said("success"), [
    "`8` already has an App Store Connect API key (OLDKEY0001). Nothing was created. Pass --replace to create another and save it instead.",
  ]);

  const listed = await scenario(list, { flags: { app: "8" }, api: UNNAMED });
  assert.deepEqual(listed.said("step"), ["Apple keys saved on `8`"]);
});

test("creating an In-App Purchase key for an app without a bundle ID warns about test mode first", async () => {
  const run = await scenario(create, {
    args: { kind: "purchase_key" },
    flags: { app: "8", bundleId: "com.acme.app" },
    api: {
      ...NO_BUNDLE,
      candidates: [
        {
          bundle_id: "com.acme.beta",
          production_devices: 1,
          sandbox_devices: 0,
          last_seen_at: "2026-10-10T00:00:00Z",
          top_country: null,
        },
      ],
    },
  });

  assert.deepEqual(run.said("warn")[0], "Saving the bundle ID com.acme.app: 1 production device in the last 30 days used com.acme.beta, and would run in test mode.");
  assert.deepEqual(run.said("success"), ["In-App Purchase key IAPKEY0001 created and saved on `Acme`."]);
});

test("a new key is kept on disk when Superwall can't be reached to save it", async () => {
  const run = await scenario(create, {
    args: { kind: "api_key" },
    api: { failAppSave: new TypeError("fetch failed") },
    json: true,
  });

  assert.deepEqual(run.files, { "AuthKey_TEAMKEY001.p8": PEM });
  assert.match((run.result.json as { detail: string }).detail, /^Superwall couldn't save the key: fetch failed\. Apple only releases a key once/);
  assert.equal(process.exitCode, 1);
});
