import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { runAsc } from "@/commands/platform/asc";
import { ApiError } from "@/core/api/client";
import { fakeApi, type ApiOptions } from "../../helpers/apple-setup";
import { run } from "../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

const INTEGRATIONS = "/internal/v2/applications/8/integrations";
const KEY_FILE = join(mkdtempSync(join(tmpdir(), "superwall-keys-")), "AuthKey.p8");
writeFileSync(KEY_FILE, "PEM");

async function keys(
  argv: Record<string, unknown>,
  options: ApiOptions & { interactive?: boolean; confirm?: boolean | null } = {},
) {
  const { api, requests } = fakeApi(options);
  const calls: RendererCall[] = [];
  const renderer = {
    ...recordingRenderer(calls),
    confirm: async (value: unknown) => (calls.push({ method: "confirm", value }), options.confirm ?? null),
  };
  const result = await run(runAsc.definition, {
    argv: { target: "keys", ...argv },
    api,
    interactive: options.interactive ?? false,
    renderer,
  });
  return {
    json: () => result.json,
    said: (method: string) =>
      calls
        .filter((call) => call.method === method)
        .map((call) => String(call.value ?? "").replace(/\u001B\[[0-9;]*m/g, "")),
    requests,
    wrote: (method: string, fragment: string) =>
      requests.filter((request) => request.method === method && request.path.includes(fragment)),
  };
}

const SAVED = {
  app_store_connect_configuration: { key_id: "APIKEY0001", issuer_id: "issuer-1", has_private_key: true },
  in_app_purchase_configuration: null,
};

test("keys list --app says which of the two keys the app has, and never a private key", async () => {
  const json = await keys({ value: "list", app: "8", json: true }, { saved: SAVED });
  assert.deepEqual(json.json(), {
    application_id: "8",
    api_key: { key_id: "APIKEY0001", issuer_id: "issuer-1" },
    purchase_key: null,
  });
  const human = await keys({ value: "list", app: "Acme" }, { saved: SAVED });
  assert.deepEqual(human.said("report"), [
    "✓ App Store Connect API key  APIKEY0001\n✗ In-App Purchase key  not saved",
  ]);
});

test("keys import tries both kinds and exits non-zero when one is still missing", async () => {
  const results: Record<string, unknown> = {
    api_key: {
      kind: "api_key",
      status: "imported",
      key_id: "APIKEY0001",
      source_name: "Other App",
      source_application_id: "12",
      tried: 2,
      timed_out: false,
    },
    purchase_key: {
      kind: "purchase_key",
      status: "not_found",
      key_id: null,
      source_name: null,
      source_application_id: null,
      tried: 0,
      timed_out: false,
    },
  };
  const routes = (method: string, path: string, body?: unknown) =>
    method === "POST" && path === `${INTEGRATIONS}/app-store-keys/import`
      ? results[(body as { kind: string }).kind]
      : undefined;
  const json = await keys({ value: "import", app: "8", json: true }, { routes });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(
    (json.json() as { results: Array<{ kind: string; status: string }> }).results.map(
      (result) => [result.kind, result.status],
    ),
    [
      ["api_key", "imported"],
      ["purchase_key", "not_found"],
    ],
  );

  process.exitCode = undefined;
  const one = await keys({ value: "import", value2: "api_key", app: "8" }, { routes });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(one.said("report"), [
    "✓ App Store Connect API key APIKEY0001 imported to Acme from Other App.",
  ]);
  assert.equal(one.wrote("POST", "/app-store-keys/import").length, 1);
});

test("keys import words each way of finding nothing", async () => {
  const answer = (extra: Record<string, unknown>) => ({
    routes: (method: string, path: string) =>
      method === "POST" && path.endsWith("/app-store-keys/import")
        ? {
            kind: "purchase_key",
            status: "not_found",
            key_id: null,
            source_name: null,
            source_application_id: null,
            tried: 3,
            timed_out: false,
            ...extra,
          }
        : undefined,
  });
  const argv = { value: "import", value2: "purchase_key", app: "8" };
  const none = await keys(argv, answer({}));
  assert.match(none.said("report")[0] ?? "", /None of your organization's 3 saved In-App Purchase keys is confirmed/);
  const empty = await keys(argv, answer({ tried: 0 }));
  assert.match(empty.said("report")[0] ?? "", /has no In-App Purchase key to try on Acme/);
  const slow = await keys(argv, answer({ timed_out: true }));
  assert.match(slow.said("report")[0] ?? "", /ran out of time \(3 tried\)/);
  process.exitCode = undefined;
  const kept = await keys(argv, answer({ status: "already_saved", key_id: "IAP1" }));
  assert.equal(process.exitCode, undefined);
  assert.match(kept.said("report")[0] ?? "", /✓ Acme already has an In-App Purchase key \(IAP1\)/);

  const bad = await keys({ value: "import", value2: "team", app: "8" });
  assert.match(bad.said("error")[0] ?? "", /Usage: superwall asc keys import/);
});

test("keys sources lists the keys on the organization's other apps", async () => {
  const sources = {
    api_key: [{ application_id: "12", name: "Other App", key_id: "APIKEY0001", others_count: 2 }],
    purchase_key: [],
  };
  const routes = (method: string, path: string) =>
    method === "GET" && path.endsWith("/app-store-keys/copy-sources") ? sources : undefined;
  const json = await keys({ value: "sources", app: "8", json: true }, { routes });
  assert.deepEqual(json.json(), { application_id: "8", ...sources });
  const human = await keys({ value: "sources", app: "8" }, { routes });
  assert.deepEqual(human.said("info"), [
    "`APIKEY0001`  App Store Connect API key  from Other App and 2 more (app 12)",
  ]);
  const none = await keys(
    { value: "sources", app: "8" },
    { routes: (method, path) => (path.endsWith("/copy-sources") ? { api_key: [], purchase_key: [] } : undefined) },
  );
  assert.deepEqual(none.said("step"), ["No other app has a key `Acme` could use"]);
});

test("keys copy saves a confirmed key and refuses an unconfirmed one without the flag", async () => {
  const bodies: unknown[] = [];
  const routes = (method: string, path: string, body?: unknown) => {
    if (method !== "POST" || !path.endsWith("/app-store-keys/copy")) return undefined;
    bodies.push(body);
    const confirmed = (body as { confirmed?: boolean }).confirmed === true;
    return confirmed
      ? { kind: "api_key", valid: true, error: null, unconfirmed: null }
      : { kind: "api_key", valid: false, error: null, unconfirmed: "This team has no app com.acme.app." };
  };
  const argv = { value: "copy", value2: "api_key", app: "8", from: 12 };

  const refused = await keys(argv, { routes });
  assert.equal(process.exitCode, 1);
  assert.match(refused.said("error")[0] ?? "", /This team has no app com\.acme\.app\./);
  assert.match(refused.said("error")[0] ?? "", /Nothing was saved\. Pass --allow-unconfirmed/);
  assert.deepEqual(bodies, [{ kind: "api_key", source_application_id: "12" }]);

  process.exitCode = undefined;
  const allowed = await keys({ ...argv, "allow-unconfirmed": true, json: true }, { routes });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(allowed.json(), {
    application_id: "8",
    kind: "api_key",
    from: "12",
    valid: true,
    error: null,
    unconfirmed: null,
  });

  bodies.length = 0;
  const asked = await keys(argv, { routes, interactive: true, confirm: true });
  assert.deepEqual(asked.said("success"), ["App Store Connect API key copied to `Acme`."]);
  assert.deepEqual(bodies, [
    { kind: "api_key", source_application_id: "12" },
    { kind: "api_key", source_application_id: "12", confirmed: true },
  ]);

  bodies.length = 0;
  await keys(argv, { routes, interactive: true, confirm: false });
  assert.equal(process.exitCode, 1);
  assert.equal(bodies.length, 1);
});

test("keys copy reports a key that no longer works, and needs a kind and a source", async () => {
  const dead = await keys(
    { value: "copy", value2: "purchase_key", app: "8", from: "12" },
    {
      routes: (method, path) =>
        path.endsWith("/app-store-keys/copy")
          ? { kind: "purchase_key", valid: false, error: "Apple rejected this key.", unconfirmed: null }
          : undefined,
    },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(dead.said("error"), ["Apple rejected this key.\nNothing was saved."]);

  const noKind = await keys({ value: "copy", app: "8", from: "12" });
  assert.match(noKind.said("error")[0] ?? "", /Usage: superwall asc keys copy <api_key \| purchase_key>/);
  const noSource = await keys({ value: "copy", value2: "api_key", app: "8" });
  assert.match(noSource.said("error")[0] ?? "", /--from <app id>.*asc keys sources/);
});

test("keys set --app saves a key file on the app, and a rejected key exits non-zero", async () => {
  const flags = { "key-id": "K1", issuer: "I1", "key-file": KEY_FILE };
  const api = await keys({ value: "set", app: "8", ...flags, json: true });
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

  const purchase = await keys(
    { value: "set", value2: "purchase_key", app: "8", ...flags },
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
  const saved = await keys({ value: "set", value2: "purchase_key", app: "8", ...flags });
  assert.deepEqual(saved.said("success"), ["In-App Purchase key K1 saved on `Acme`."]);

  const bare = await keys(
    { value: "set", value2: "purchase_key", app: "8", ...flags },
    { projects: [{ id: 5, applications: [{ id: 8, name: "Acme", platform: "ios" }] }] },
  );
  assert.deepEqual(bare.said("error"), ["Acme has no bundle ID in Superwall. Pass --bundle-id <id>."]);

  const usage = await keys({ value: "set", app: "8" });
  assert.match(usage.said("error")[0] ?? "", /asc keys set \[api_key \| purchase_key\] --app <id>/);
  const wrongKind = await keys({ value: "set", value2: "team", app: "8", ...flags });
  assert.match(wrongKind.said("error")[0] ?? "", /Usage: superwall asc keys set <api_key \| purchase_key>/);
  assert.equal(wrongKind.wrote("PUT", "").length, 0);
});

test("keys rm --app removes one kind from the app and says what is untouched", async () => {
  const routes = (method: string) => (method === "DELETE" ? { kind: "purchase_key" } : undefined);
  const run1 = await keys({ value: "rm", value2: "purchase_key", app: "8" }, { routes });
  assert.deepEqual(
    run1.wrote("DELETE", "").map((request) => request.path),
    [`${INTEGRATIONS}/app-store-keys/purchase_key`],
  );
  assert.match(run1.said("success")[0] ?? "", /Nothing was revoked at Apple/);
  const json = await keys({ value: "rm", value2: "api_key", app: "8", json: true }, { routes });
  assert.deepEqual(json.json(), { deleted: true, kind: "api_key", application_id: "8" });
  const usage = await keys({ value: "rm", app: "8" });
  assert.match(usage.said("error")[0] ?? "", /Usage: superwall asc keys rm <api_key \| purchase_key>/);
  const noApp = await keys({ value: "rm", value2: "api_key" }, { routes });
  assert.deepEqual(noApp.said("error"), ["Usage: superwall asc keys rm api_key --app <id>"]);
  assert.equal(noApp.wrote("DELETE", "").length, 0);
});

test("--dry-run plans each write without making it", async () => {
  const flags = { "key-id": "K1", issuer: "I1", "key-file": KEY_FILE, app: "8", dryRun: true };
  for (const argv of [
    { value: "set", ...flags },
    { value: "rm", value2: "api_key", ...flags },
    { value: "copy", value2: "api_key", from: "12", ...flags },
    { value: "import", ...flags },
  ]) {
    const human = await keys(argv);
    assert.match(human.said("info")[0] ?? "", /^\[dry-run\] would /);
    assert.equal(human.requests.length, 0);
    const json = await keys({ ...argv, json: true });
    assert.equal((json.json() as { dryRun: boolean }).dryRun, true);
  }
});

test("an API that does not have the key endpoints yet says so and changes nothing", async () => {
  const run1 = await keys(
    { value: "sources", app: "8" },
    {
      routes: (method, path) => {
        if (path.endsWith("/copy-sources")) throw new ApiError(`GET ${path}`, 404, "");
        return undefined;
      },
    },
  );
  assert.deepEqual(run1.said("error"), [
    "The Superwall API at https://api.example.com can't list the keys on your other apps yet. Nothing was changed.",
  ]);

  const missingApp = await keys(
    { value: "sources", app: "8" },
    {
      routes: (method, path) => {
        if (path.endsWith("/copy-sources")) {
          throw new ApiError(`GET ${path}`, 404, '{"message":"No such application: 8"}');
        }
        return undefined;
      },
    },
  );
  assert.match(missingApp.said("error")[0] ?? "", /No such application: 8/);
});

test("replacing an organization's key asks Superwall to check the team", async () => {
  const flags = { "key-id": "K1", issuer: "I1", "key-file": KEY_FILE };
  const routes = (method: string, path: string) =>
    path.startsWith("/v2/organizations/9/app-store-connect") ? { team_id: "TEAM1" } : undefined;
  const replaced = await keys({ value: "set", team: "TEAM1", ...flags }, { routes });
  assert.deepEqual(replaced.wrote("PATCH", "/app-store-connect/TEAM1")[0]?.body, {
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
    validate: true,
  });
  const created = await keys({ value: "set", ...flags, json: true }, { routes });
  assert.deepEqual(created.wrote("POST", "/app-store-connect")[0]?.body, {
    key_id: "K1",
    issuer_id: "I1",
    private_key: "PEM",
    account_name: "App Store Connect",
  });
  const planned = await keys({ value: "set", team: "TEAM1", ...flags, dryRun: true, json: true });
  assert.equal((planned.json() as { teamId: string }).teamId, "TEAM1");
});

test("unknown key actions name the ones that exist", async () => {
  const run1 = await keys({ value: "rotate" });
  assert.deepEqual(run1.said("error"), [
    'Unknown "asc keys rotate". Use list | set | rm | create | sources | copy | import.',
  ]);
});
