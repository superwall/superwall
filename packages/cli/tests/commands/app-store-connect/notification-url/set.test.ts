import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as set } from "@/commands/app-store-connect/notification-url/set";
import { OURS, environment, outcome, runNotificationUrl as url } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

const THEIRS = "https://api.revenuecat.com/v1/incoming-webhooks/apple";

test("set writes once, never asks to replace, and leaves the provider alone by default", async () => {
  const json = await url(set, { json: true, flags: { app: "8" } });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(json.calls(), [["PUT", {}]]);
  assert.equal((json.result.json as { apple: { status: string } }).apple.status, "set");
  assert.equal(
    (json.result.json as { set_revenue_provider: boolean }).set_revenue_provider,
    false,
  );

  const provider = await url(set, { flags: { app: "8", setRevenueProvider: true } });
  assert.deepEqual(provider.calls(), [["PUT", { set_revenue_provider: true }]]);
  assert.match(
    provider.result.said("success")[0] ?? "",
    /^Apple now sends this app's server notifications to Superwall\./,
  );

  const already = await url(set, { flags: { app: "8" } }, { written: [outcome("already_set")] });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(already.result.said("success"), [
    "Apple already sends this app's server notifications to Superwall.",
  ]);
});

test("set reports another server's URL and exits non-zero", async () => {
  const run1 = await url(set, { flags: { app: "8" } },
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
  const run1 = await url(set, { flags: { app: "8" } }, { written: [waiting, waiting, outcome("set")] });
  assert.deepEqual(run1.sleeps, [1000, 2000]);
  assert.equal(process.exitCode, undefined);

  const never = await url(set, { flags: { app: "8" } }, { written: Array(4).fill(waiting) });
  assert.equal(never.sleeps.length, 3);
  assert.equal(process.exitCode, 1);
  assert.deepEqual(never.result.said("error"), ["Apple hasn’t accepted the new key yet."]);
});

test("--dry-run on set says what it would write and writes nothing", async () => {
  const human = await url(set, { flags: { app: "8", dryRun: true } });
  assert.deepEqual(human.result.said("info"), [
    `[dry-run] would set ${OURS} where Apple has no server notification URL.`,
  ]);
  assert.deepEqual(human.calls(), []);
  const json = await url(set, { json: true, flags: { app: "8", dryRun: true } });
  assert.deepEqual(json.result.json, {
    dryRun: true,
    action: "set",
    application_id: "8",
    url: OURS,
    set_revenue_provider: false,
  });
});

