import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { CommandDefinition } from "@/command";
import { runAsc } from "@/commands/platform/asc";
import { runNotificationUrl } from "@/commands/platform/notification-url";
import { ApiError } from "@/core/api/client";
import { OURS, environment, fakeApi, outcome, type ApiOptions } from "../../helpers/apple-setup";
import { run } from "../../helpers/command";

afterEach(() => {
  process.exitCode = undefined;
});

const PATH = "/v2/projects/5/applications/8/integrations/app-store-connect/notification-url/apple";
const THEIRS = "https://api.revenuecat.com/v1/incoming-webhooks/apple";
const ANOTHER_APP = "https://integrations.superwall.com/integrations/app-store-connect/webhook?pk=pk_other";
const CAMERA_LITE = { id: 12, name: "Camera Lite" };

async function url(argv: Record<string, unknown>, options: ApiOptions = {}) {
  const { api, requests } = fakeApi(options);
  const sleeps: number[] = [];
  const definition: CommandDefinition<"required"> = {
    name: "asc",
    auth: "required",
    output: "both",
    run: (ctx) =>
      runNotificationUrl(ctx, async (ms) => {
        sleeps.push(ms);
      }),
  };
  const result = await run(definition, { argv: { target: "notification-url", ...argv }, api });
  return {
    result,
    sleeps,
    calls: () =>
      requests
        .filter((request) => request.path === PATH)
        .map((request) => [request.method, request.body ?? null] as const),
  };
}

test("get prints this app's Superwall URL and asks Apple nothing", async () => {
  const human = await url({ app: "8" });
  assert.deepEqual(human.result.said("report"), [OURS]);
  assert.deepEqual(human.calls(), []);
  const json = await url({ value: "get", app: "8", json: true });
  assert.deepEqual(json.result.json, { application_id: "8", url: OURS });
});

test("check reads whose each environment's URL is, and changes nothing", async () => {
  const conflict = await url(
    { value: "check", app: "8", json: true },
    {
      checks: [
        outcome("conflict", {
          message: "left alone",
          production: environment("superwall_app", ANOTHER_APP, CAMERA_LITE),
          sandbox: environment("other", THEIRS),
        }),
      ],
    },
  );
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(conflict.result.json, {
    application_id: "8",
    url: OURS,
    apple: {
      status: "conflict",
      message: "left alone",
      production: {
        owner: "superwall_app",
        url: ANOTHER_APP,
        token_redacted: false,
        application: CAMERA_LITE,
      },
      sandbox: { owner: "other", url: THEIRS, token_redacted: false, application: null },
    },
  });
  assert.deepEqual(conflict.calls(), [["GET", null]]);

  const human = await url(
    { value: "check", app: "8" },
    {
      checks: [
        outcome("conflict", {
          production: environment("superwall_app", ANOTHER_APP, CAMERA_LITE),
          sandbox: environment("superwall_app", ANOTHER_APP, CAMERA_LITE),
        }),
      ],
    },
  );
  assert.deepEqual(human.result.said("info"), [
    [
      "Apple sends this app's server notifications to another Superwall app. Superwall won't replace it.",
      `  Production: another Superwall app, Camera Lite (app 12)  ${ANOTHER_APP}`,
      `  Sandbox: another Superwall app, Camera Lite (app 12)  ${ANOTHER_APP}`,
    ].join("\n"),
  ]);
});

test("check says what is this app's, what is empty, and an app it may not see", async () => {
  const own = await url(
    { value: "check", app: "8" },
    {
      checks: [
        outcome("already_set", {
          production: environment("this_app"),
          sandbox: environment("this_app"),
        }),
      ],
    },
  );
  assert.deepEqual(own.result.said("success"), [
    "Apple already sends this app's server notifications to Superwall.\n  Production: this app's Superwall URL\n  Sandbox: this app's Superwall URL",
  ]);

  const half = await url(
    { value: "check", app: "8" },
    {
      checks: [
        outcome("not_set", { production: environment("this_app"), sandbox: environment("none") }),
      ],
    },
  );
  assert.match(
    half.result.said("info")[0] ?? "",
    /No other server holds either\.\n {2}Production: this app's Superwall URL\n {2}Sandbox: none$/,
  );

  const redacted = ANOTHER_APP.replace("pk_other", "REDACTED");
  const hidden = await url(
    { value: "check", app: "8" },
    {
      checks: [
        outcome("conflict", {
          production: {
            owner: "superwall_app",
            url: redacted,
            token_redacted: true,
            application: null,
          },
          sandbox: environment("none"),
        }),
      ],
    },
  );
  assert.match(
    hidden.result.said("info")[0] ?? "",
    /Production: another Superwall app {2}https:\/\/.*pk=REDACTED/,
  );
});

test("check exits non-zero when Apple could not be asked", async () => {
  const skipped = await url(
    { value: "check", app: "8" },
    { checks: [outcome("skipped", { message: "This app has no bundle ID in Superwall yet." })] },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(skipped.result.said("error"), ["This app has no bundle ID in Superwall yet."]);

  process.exitCode = undefined;
  const failed = await url({ value: "check", app: "8" }, { checks: [outcome("failed")] });
  assert.equal(process.exitCode, 1);
  assert.match(failed.result.said("error")[0] ?? "", /Apple couldn't be asked/);

  process.exitCode = undefined;
  const silent = await url({ value: "check", app: "8" }, { checks: [outcome("skipped")] });
  assert.match(silent.result.said("error")[0] ?? "", /can't be asked/);
});

test("set writes once, never asks to replace, and leaves the provider alone by default", async () => {
  const json = await url({ value: "set", app: "8", json: true });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(json.calls(), [["PUT", {}]]);
  assert.equal((json.result.json as { apple: { status: string } }).apple.status, "set");
  assert.equal(
    (json.result.json as { set_revenue_provider: boolean }).set_revenue_provider,
    false,
  );

  const provider = await url({ value: "set", app: "8", "set-revenue-provider": true });
  assert.deepEqual(provider.calls(), [["PUT", { set_revenue_provider: true }]]);
  assert.match(
    provider.result.said("success")[0] ?? "",
    /^Apple now sends this app's server notifications to Superwall\./,
  );

  const already = await url({ value: "set", app: "8" }, { written: [outcome("already_set")] });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(already.result.said("success"), [
    "Apple already sends this app's server notifications to Superwall.",
  ]);
});

test("set reports another server's URL and exits non-zero", async () => {
  const run1 = await url(
    { value: "set", app: "8" },
    {
      written: [
        outcome("conflict", {
          production: environment("other", THEIRS),
          sandbox: environment("none"),
        }),
      ],
    },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run1.calls(), [["PUT", {}]]);
  assert.deepEqual(run1.result.said("error"), [
    `Apple sends this app's server notifications to another server. Superwall won't replace it.\n  Production: another server  ${THEIRS}\n  Sandbox: none`,
  ]);
});

test("waits for a key Apple has only just created, then gives up with its message", async () => {
  const waiting = outcome("failed", {
    message: "Apple hasn’t accepted the new key yet.",
    retryable: true,
  });
  const run1 = await url({ value: "set", app: "8" }, { written: [waiting, waiting, outcome("set")] });
  assert.deepEqual(run1.sleeps, [1000, 2000]);
  assert.equal(process.exitCode, undefined);

  const never = await url({ value: "check", app: "8" }, { checks: Array(4).fill(waiting) });
  assert.equal(never.sleeps.length, 3);
  assert.equal(process.exitCode, 1);
  assert.deepEqual(never.result.said("error"), ["Apple hasn’t accepted the new key yet."]);
});

test("an API without these endpoints yet is refused clearly and nothing is written", async () => {
  for (const [value, verb] of [
    ["check", "read"],
    ["set", "set"],
  ] as const) {
    const old = await url({ value, app: "8" }, { failCheck: new ApiError("PUT /x", 404, "") });
    assert.equal(process.exitCode, 1);
    assert.match(
      old.result.said("error")[0] ?? "",
      new RegExp(`can't ${verb} Apple's server notification URLs yet\\. Nothing was changed\\.`),
    );
    process.exitCode = undefined;
  }
  const forbidden = await url(
    { value: "check", app: "8" },
    { failCheck: new ApiError("GET /x", 403, '{"message":"Forbidden"}') },
  );
  assert.deepEqual(
    forbidden.result.said("error").map((line) => line.split("\n")[0]),
    ["Forbidden"],
  );
});

test("--dry-run on set says what it would write and writes nothing", async () => {
  const human = await url({ value: "set", app: "8", dryRun: true });
  assert.deepEqual(human.result.said("info"), [
    `[dry-run] would set ${OURS} where Apple has no server notification URL.`,
  ]);
  assert.deepEqual(human.calls(), []);
  const json = await url({ value: "set", app: "8", dryRun: true, json: true });
  assert.deepEqual(json.result.json, {
    dryRun: true,
    action: "set",
    application_id: "8",
    url: OURS,
    set_revenue_provider: false,
  });
});

test("unknown actions name the ones that exist, and asc routes to it", async () => {
  const bad = await url({ value: "replace", app: "8" });
  assert.deepEqual(bad.result.said("error"), [
    'Unknown "asc notification-url replace". Use get | check | set.',
  ]);
  const { api } = fakeApi();
  const routed = await run(runAsc.definition, {
    argv: { target: "notification-url", app: "8", json: true },
    api,
  });
  assert.deepEqual(routed.json, { application_id: "8", url: OURS });
});
