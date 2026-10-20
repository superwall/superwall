import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { testModeExposure } from "@/commands/resource/bundle-id";
import { runResource } from "@/commands/resource/resource";
import { ApiError } from "@/core/api/client";
import { fakeApi, type ApiOptions } from "../../helpers/apple-setup";
import { run } from "../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

const candidate = (bundleId: string, production: number, sandbox = 0) => ({
  bundle_id: bundleId,
  production_devices: production,
  sandbox_devices: sandbox,
  last_seen_at: "2026-10-14T17:00:00Z",
  top_country: "US",
});

const SUGGESTIONS = {
  window_days: 30,
  available: true,
  candidates: [
    candidate("com.acme.app", 9_630),
    candidate("com.acme.app.widget", 3_410),
    candidate("com.acme.habits", 1_204),
    candidate("com.acme.app.dev", 0, 300),
    candidate("com.acme.appkids", 50),
  ],
};

const bare = (platform = "ios", bundleId?: string) => [
  { id: 5, name: "Main", applications: [{ id: 8, name: "Acme", platform, ...(bundleId ? { bundle_id: bundleId } : {}) }] },
];

async function bundleId(
  argv: Record<string, unknown>,
  options: ApiOptions & {
    suggestions?: unknown;
    save?: (body: unknown) => unknown;
    interactive?: boolean;
    confirm?: boolean | null;
  } = {},
) {
  const saves: unknown[] = [];
  const { api, requests } = fakeApi({
    projects: options.projects ?? bare(),
    routes: (method, path, body) => {
      if (method === "GET" && path === "/internal/v2/applications/8/bundle-id-suggestions") {
        if (options.suggestions instanceof Error) throw options.suggestions;
        return options.suggestions ?? SUGGESTIONS;
      }
      if (method === "POST" && path === "/internal/v2/applications/8/bundle-id") {
        saves.push(body);
        if (options.save) return options.save(body);
        const sent = body as { bundle_id: string; app_store_id?: string };
        return { bundle_id: sent.bundle_id, app_store_id: sent.app_store_id ?? null };
      }
      return undefined;
    },
  });
  const calls: RendererCall[] = [];
  const renderer = {
    ...recordingRenderer(calls),
    confirm: async (value: unknown) => (calls.push({ method: "confirm", value }), options.confirm ?? null),
  };
  const result = await run(runResource("apps").definition, {
    argv: { action: "bundle-id", project: "5", app: "8", ...argv },
    api,
    interactive: options.interactive ?? false,
    renderer,
  });
  return {
    result,
    saves,
    requests,
    said: (method: string) =>
      calls
        .filter((call) => call.method === method)
        .map((call) => String(call.value ?? "").replace(/\u001B\[[0-9;]*m/g, "")),
  };
}

test("counts production devices on IDs that neither equal nor extend the chosen one", () => {
  assert.deepEqual(testModeExposure("com.acme.app", SUGGESTIONS.candidates), {
    devices: 1_254,
    bundleIds: ["com.acme.habits", "com.acme.appkids"],
  });
  assert.equal(testModeExposure("com.acme.app.widget", SUGGESTIONS.candidates).devices, 9_630 + 1_204 + 50);
  assert.equal(testModeExposure("com.acme.habits", [candidate("com.acme.habits", 4)]).devices, 0);
});

test("with no value it reads the saved ID and what the SDK reported, and changes nothing", async () => {
  const json = await bundleId({ json: true });
  assert.deepEqual(json.result.json, {
    application_id: "8",
    platform: "ios",
    bundle_id: null,
    suggestions: SUGGESTIONS,
  });
  assert.deepEqual(json.saves, []);

  const human = await bundleId({}, { projects: bare("android", "com.acme.android") });
  assert.deepEqual(human.said("step"), ["`Acme` has the package name `com.acme.android`"]);
  assert.equal(human.said("info")[0], "What the SDK reported in the last 30 days:");
  assert.equal(
    human.said("info")[1],
    "`com.acme.app`  9630 production, 0 sandbox devices, last seen 2026-10-14, mostly US",
  );

  const none = await bundleId({}, { suggestions: { window_days: 30, available: true, candidates: [] } });
  assert.deepEqual(none.said("info"), ["The SDK reported no bundle ID in the last 30 days."]);
  const down = await bundleId({}, { suggestions: { window_days: 30, available: false, candidates: [] } });
  assert.deepEqual(down.said("info"), ["The SDK's reports couldn't be read just now."]);
  const old = await bundleId({}, { suggestions: new ApiError("GET /x", 404, "") });
  assert.deepEqual(old.said("info"), ["This Superwall API can't suggest one yet."]);
});

test("saves an ID no other production build uses without asking", async () => {
  const run1 = await bundleId(
    { value: "com.acme.app" },
    { suggestions: { window_days: 30, available: true, candidates: [candidate("com.acme.app", 10), candidate("com.acme.app.widget", 3)] } },
  );
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run1.saves, [{ bundle_id: "com.acme.app" }]);
  assert.deepEqual(run1.said("success"), ["`Acme` now has the bundle ID `com.acme.app`."]);
});

test("states the test-mode count and needs --yes outside a terminal", async () => {
  const refused = await bundleId({ value: "com.acme.app" });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(refused.saves, []);
  const message = refused.said("error")[0] ?? "";
  assert.match(message, /1254 production devices in the last 30 days used com\.acme\.habits, com\.acme\.appkids, and would run in test mode\./);
  assert.match(message, /Nothing was changed\. This is a person's decision: once they agree, run it again with --yes\./);

  process.exitCode = undefined;
  const agreed = await bundleId({ value: "com.acme.app", yes: true, "app-store-id": "6470000001", json: true });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(agreed.saves, [{ bundle_id: "com.acme.app", app_store_id: "6470000001" }]);
  assert.deepEqual(agreed.result.json, {
    application_id: "8",
    bundle_id: "com.acme.app",
    app_store_id: "6470000001",
    changed: true,
    previous: null,
    test_mode: { devices: 1254, bundleIds: ["com.acme.habits", "com.acme.appkids"] },
  });
});

test("asks in a terminal, and a refusal saves nothing", async () => {
  const yes = await bundleId({ value: "com.acme.app" }, { interactive: true, confirm: true });
  assert.match(yes.said("warn")[0] ?? "", /would run in test mode/);
  assert.equal(yes.saves.length, 1);
  for (const confirm of [false, null]) {
    const no = await bundleId({ value: "com.acme.app" }, { interactive: true, confirm });
    assert.deepEqual(no.saves, []);
    assert.equal(no.said("warn").at(-1), "Cancelled. Nothing was changed.");
  }
});

test("replaces a saved ID only with --replace, and confirms that too", async () => {
  const projects = bare("ios", "com.acme.old");
  const refused = await bundleId({ value: "com.acme.new" }, { projects, suggestions: { window_days: 30, available: true, candidates: [] } });
  assert.equal(process.exitCode, 1);
  assert.match(refused.said("error")[0] ?? "", /already has the bundle ID com\.acme\.old\. Nothing was changed\. Pass --replace/);
  assert.deepEqual(refused.saves, []);

  process.exitCode = undefined;
  const unconfirmed = await bundleId(
    { value: "com.acme.new", replace: true },
    { projects, suggestions: { window_days: 30, available: true, candidates: [] } },
  );
  assert.equal(process.exitCode, 1);
  assert.match(unconfirmed.said("error")[0] ?? "", /This replaces the bundle ID com\.acme\.old with com\.acme\.new/);
  assert.deepEqual(unconfirmed.saves, []);

  process.exitCode = undefined;
  const replaced = await bundleId(
    { value: "com.acme.new", replace: true, yes: true },
    { projects, suggestions: { window_days: 30, available: true, candidates: [] } },
  );
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(replaced.saves, [{ bundle_id: "com.acme.new", replace: true }]);
});

test("the ID it already has, a dry run, and the API's refusals", async () => {
  const same = await bundleId({ value: "com.acme.app", json: true }, { projects: bare("ios", "com.acme.app") });
  assert.deepEqual(same.result.json, { application_id: "8", bundle_id: "com.acme.app", changed: false });
  assert.deepEqual(same.saves, []);

  const dry = await bundleId({ value: "com.acme.app", dryRun: true });
  assert.match(dry.said("info")[0] ?? "", /^\[dry-run\] would save the bundle ID com\.acme\.app on Acme\.\n1254 production devices/);
  assert.deepEqual(dry.saves, []);

  const conflict = await bundleId(
    { value: "com.acme.app", yes: true },
    {
      save: () => {
        throw new ApiError("POST /x", 409, '{"message":"This app already has the bundle ID com.acme.other, so it was left as it is."}');
      },
    },
  );
  assert.equal(process.exitCode, 1);
  assert.match(conflict.said("error")[0] ?? "", /left as it is\. Nothing was changed\. Pass --replace/);

  process.exitCode = undefined;
  const invalid = await bundleId(
    { value: "acme", yes: true },
    {
      save: () => {
        throw new ApiError("POST /x", 400, '{"message":"That isn\'t a valid bundle ID."}');
      },
    },
  );
  assert.match(invalid.said("error")[0] ?? "", /That isn't a valid bundle ID\./);

  process.exitCode = undefined;
  const web = await bundleId({}, { projects: bare("web") });
  assert.deepEqual(web.said("error"), ["Only iOS and Android apps have a bundle ID."]);
});
