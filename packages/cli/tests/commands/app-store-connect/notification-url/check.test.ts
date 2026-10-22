import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { resolveLine } from "@/program/parse";
import { command as check } from "@/commands/app-store-connect/notification-url/check";
import { command as set } from "@/commands/app-store-connect/notification-url/set";
import { ApiError } from "@/core/api/client";
import { OURS, environment, outcome, runNotificationUrl as url } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const THEIRS = "https://api.revenuecat.com/v1/incoming-webhooks/apple";
const ANOTHER_APP = "https://integrations.superwall.com/integrations/app-store-connect/webhook?pk=pk_other";
const CAMERA_LITE = { id: 12, name: "Camera Lite" };

test("check reads whose each environment's URL is, and changes nothing", async () => {
  const conflict = await url(check, { json: true, flags: { app: "8" } },
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

  const human = await url(check, { flags: { app: "8" } },
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
  const own = await url(check, { flags: { app: "8" } },
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

  const half = await url(check, { flags: { app: "8" } },
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
  const hidden = await url(check, { flags: { app: "8" } },
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
  const skipped = await url(check, { flags: { app: "8" } },
    { checks: [outcome("skipped", { message: "This app has no bundle ID in Superwall yet." })] },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(skipped.result.said("error"), ["This app has no bundle ID in Superwall yet."]);

  process.exitCode = undefined;
  const failed = await url(check, { flags: { app: "8" } }, { checks: [outcome("failed")] });
  assert.equal(process.exitCode, 1);
  assert.match(failed.result.said("error")[0] ?? "", /Apple couldn't be asked/);

  process.exitCode = undefined;
  const silent = await url(check, { flags: { app: "8" } }, { checks: [outcome("skipped")] });
  assert.match(silent.result.said("error")[0] ?? "", /can't be asked/);
});

test("check asks once and reports what Apple said, without waiting", async () => {
  const refused = outcome("failed", {
    message: "Apple refused the App Store Connect API key saved on this app.",
  });
  const once = await url(check, { flags: { app: "8" } }, { checks: [refused, outcome("already_set")] });
  assert.deepEqual(once.sleeps, []);
  assert.deepEqual(once.calls(), [["GET", null]]);
  assert.equal(process.exitCode, 1);
  assert.deepEqual(once.result.said("error"), [
    "Apple refused the App Store Connect API key saved on this app.",
  ]);
});

test("an API without these endpoints yet is refused clearly and nothing is written", async () => {
  for (const [command, verb] of [
    [check, "read"],
    [set, "set"],
  ] as const) {
    const old = await url(command, { flags: { app: "8" } }, { failCheck: new ApiError("PUT /x", 404, "") });
    assert.equal(process.exitCode, 1);
    assert.match(
      old.result.said("error")[0] ?? "",
      new RegExp(`can't ${verb} Apple's server notification URLs yet\\. Nothing was changed\\.`),
    );
    process.exitCode = undefined;
  }
  const forbidden = await url(check, { flags: { app: "8" } },
    { failCheck: new ApiError("GET /x", 403, '{"message":"Forbidden"}') },
  );
  assert.deepEqual(
    forbidden.result.said("error").map((line) => line.split("\n")[0]),
    ["Forbidden"],
  );
});


test("unknown notification-url commands name the ones that exist", () => {
  const groups = [
    {
      id: "app-store-connect",
      title: "App Store Connect",
      topics: [
        { name: "asc", summary: "The App Store Connect API" },
        { name: "asc notification-url", summary: "Where Apple sends the app's purchase events" },
      ],
      commands: [check, set],
    },
  ];
  assert.throws(() => resolveLine(["asc", "notification-url", "replace", "--app", "8"], groups), {
    message: '`superwall asc notification-url` has no "replace". It takes: check, set.',
  });
});
