import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as setupApple } from "@/commands/app-store-connect/setup/apple";
import { createAppleSession } from "@/core/app-store-connect/apple-web/session";
import { fakeApple, fixedRandom, jsonResponse, vector, type FakeAppleOptions } from "../../../helpers/apple";
import {
  ACME,
  environment,
  fakeApi,
  outcome,
  scenario,
  useAppleDeps,
  type ApiOptions,
} from "../../../helpers/apple-setup";
import { runCommand } from "../../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

const NO_BUNDLE = { projects: [{ id: 5, name: "Main", applications: [{ id: 8, name: "Acme", platform: "ios" }] }] };

async function againstApple(
  apple: FakeAppleOptions,
  input: { flags?: Record<string, unknown>; json?: boolean },
  options: ApiOptions = {},
) {
  const fake = fakeApple({ twoFactor: false, ...apple });
  const { api } = fakeApi(options);
  const calls: RendererCall[] = [];
  const restore = useAppleDeps({
    session: (sessionOptions) => createAppleSession({ fetch: fake.fetch, random: fixedRandom, ...sessionOptions }),
    credentials: () => ({ appleId: vector.accountName, password: vector.password }),
    pending: { load: () => undefined, save: () => {}, clear: () => {} },
    sleep: async () => {},
    writeKeyFile: (name) => `/tmp/${name}`,
  });
  try {
    const result = await runCommand(setupApple, { ...input, api, renderer: recordingRenderer(calls) });
    return {
      result,
      said: (method: string) => calls.filter((call) => call.method === method).map((call) => String(call.value)),
    };
  } finally {
    restore();
  }
}

const refuseApiKeys = (call: { method: string; url: string }) =>
  call.method === "GET" && call.url.includes("/iris/v1/apiKeys")
    ? jsonResponse({ errors: [{ detail: "Forbidden" }] }, { status: 403 })
    : undefined;

test("--dry-run reports which kinds of key this Apple Account may create", async () => {
  const human = await againstApple({ iris: refuseApiKeys }, { flags: { dryRun: true } });
  assert.deepEqual(human.said("report"), [
    "✗ App Store Connect API key  Apple refused. Only an Admin or the Account Holder can create team keys, and the team's agreements must be signed at https://appstoreconnect.apple.com/agreements.\n✓ In-App Purchase key  ok",
  ]);
  assert.deepEqual(human.said("info").at(-1), "[dry-run] nothing was created or changed.");

  const json = await againstApple({ iris: refuseApiKeys }, { flags: { dryRun: true }, json: true });
  assert.deepEqual(json.result.json, {
    dryRun: true,
    team: ACME,
    access: {
      api_key:
        "Apple refused. Only an Admin or the Account Holder can create team keys, and the team's agreements must be signed at https://appstoreconnect.apple.com/agreements.",
      purchase_key: "ok",
    },
  });
});

test("a new bundle ID that would put reported builds in test mode is warned about first", async () => {
  const run = await scenario(setupApple, {
    api: {
      ...NO_BUNDLE,
      candidates: [
        {
          bundle_id: "com.acme.lite",
          production_devices: 12,
          sandbox_devices: 0,
          last_seen_at: "2026-10-10T00:00:00Z",
          top_country: null,
        },
      ],
    },
    flags: { app: "8", bundleId: "com.acme.app" },
  });

  assert.equal(
    run.said("warn")[0],
    "Saving the bundle ID com.acme.app: 12 production devices in the last 30 days used com.acme.lite, and would run in test mode.",
  );
  assert.equal(process.exitCode, undefined);
});

test("skipped steps read as skipped in the report", async () => {
  const run = await scenario(setupApple, {
    flags: { skipApiKey: true, skipPurchaseKey: true, skipNotificationUrl: true },
  });

  assert.deepEqual(run.said("report"), [
    "– App Store Connect API key  skipped\n– In-App Purchase key  skipped\n✓ Bundle ID  com.acme.app\n– Server notification URL  skipped",
  ]);
  assert.deepEqual(run.said("success"), ["Apple is connected for `Acme`."]);
});

test("a notification URL Apple wouldn't take is shown with each environment, without the conflict advice", async () => {
  const run = await scenario(setupApple, {
    flags: { skipApiKey: true, skipPurchaseKey: true },
    api: {
      written: [
        outcome("skipped", {
          message: "Setting the server notification URL needs the App Store Connect API key.",
          production: environment("none"),
          sandbox: environment("none"),
        }),
      ],
    },
  });

  const [error] = run.said("error");
  assert.match(error ?? "", /needs the App Store Connect API key/);
  assert.match(error ?? "", /\n  Production: /);
  assert.doesNotMatch(error ?? "", /Apple allows one URL per environment/);
  assert.equal(process.exitCode, 1);
});

test("an unexpected failure saving the bundle ID stops the run instead of reading as a refusal", async () => {
  const run = await scenario(setupApple, {
    api: {
      ...NO_BUNDLE,
      routes: (method, path) => {
        if (method === "POST" && path.endsWith("/bundle-id")) throw new Error("socket hang up");
        return undefined;
      },
    },
    flags: { app: "8", bundleId: "com.acme.app", skipPurchaseKey: true },
  });

  assert.deepEqual(run.said("error"), ["socket hang up"]);
  assert.equal(run.wrote("PUT", "/notification-url/apple").length, 0);
  assert.deepEqual(run.said("report"), []);
});

test("an unexpected failure setting the notification URL stops the run", async () => {
  const run = await scenario(setupApple, {
    flags: { skipApiKey: true, skipPurchaseKey: true },
    api: {
      routes: (_method, path) => {
        if (path.endsWith("/notification-url/apple")) throw new Error("socket hang up");
        return undefined;
      },
    },
  });

  assert.deepEqual(run.said("error"), ["socket hang up"]);
  assert.deepEqual(run.said("report"), []);
});
