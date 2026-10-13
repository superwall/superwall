import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { CommandDefinition } from "@/command";
import { runAsc } from "@/commands/platform/asc";
import { runNotificationUrl } from "@/commands/platform/notification-url";
import { ApiError } from "@/core/api/client";
import { OURS, fakeApi, outcome, type ApiOptions } from "../../helpers/apple-setup";
import { run } from "../../helpers/command";

afterEach(() => {
  process.exitCode = undefined;
});

const STEP = "/apple-setup/run-step";

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
    steps: () =>
      requests.filter((request) => request.path.endsWith(STEP)).map((request) => request.body),
  };
}

test("get prints this app's Superwall URL and asks Apple nothing", async () => {
  const human = await url({ app: "8" });
  assert.deepEqual(human.result.said("report"), [OURS]);
  assert.deepEqual(human.steps(), []);
  const json = await url({ value: "get", app: "8", json: true });
  assert.deepEqual(json.result.json, { application_id: "8", url: OURS });
});

test("check passes on Superwall's verdict and changes nothing", async () => {
  const theirs = "https://api.revenuecat.com/v1/incoming-webhooks/apple";
  const conflict = await url(
    { value: "check", app: "8", json: true },
    { checks: [outcome("conflict", { message: "left alone", production_url: theirs })] },
  );
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(conflict.result.json, {
    application_id: "8",
    url: OURS,
    apple: { status: "conflict", message: "left alone", production_url: theirs, sandbox_url: null },
  });
  assert.deepEqual(conflict.steps(), [
    { project_id: 5, application_id: 8, step: "check_notification_url" },
  ]);

  const own = await url({ value: "check", app: "8" }, { checks: [outcome("already_set")] });
  assert.deepEqual(own.result.said("success"), [
    "Apple already sends this app's server notifications to Superwall.",
  ]);
  const none = await url({ value: "check", app: "8" });
  assert.match(none.result.said("info")[0] ?? "", /No other server holds either\./);
  const human = await url(
    { value: "check", app: "8" },
    { checks: [outcome("conflict", { production_url: theirs, sandbox_url: theirs })] },
  );
  assert.deepEqual(human.result.said("info"), [
    `Apple sends this app's server notifications to another server. Superwall won't replace it.\n  Production: ${theirs}\n  Sandbox: ${theirs}`,
  ]);
});

test("check exits non-zero when Apple could not be asked", async () => {
  const skipped = await url({ value: "check", app: "8" }, { checks: [outcome("skipped")] });
  assert.equal(process.exitCode, 1);
  assert.match(skipped.result.said("error")[0] ?? "", /no App Store Connect API key saved/);

  process.exitCode = undefined;
  const failed = await url(
    { value: "check", app: "8" },
    { checks: [outcome("failed", { message: "We couldn’t read it." })] },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(failed.result.said("error"), ["We couldn’t read it."]);

  process.exitCode = undefined;
  const silent = await url({ value: "check", app: "8" }, { checks: [outcome("failed")] });
  assert.match(silent.result.said("error")[0] ?? "", /Apple couldn't be asked/);
});

test("set writes where Apple has none and leaves the revenue provider alone by default", async () => {
  const run1 = await url({ value: "set", app: "8", json: true });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run1.steps(), [
    { project_id: 5, application_id: 8, step: "check_notification_url" },
    { project_id: 5, application_id: 8, step: "notification_url" },
  ]);
  assert.deepEqual(run1.result.json, {
    application_id: "8",
    url: OURS,
    apple: { status: "set", message: null, production_url: null, sandbox_url: null },
    set_revenue_provider: false,
  });
  const human = await url({ value: "set", app: "8" });
  assert.deepEqual(human.result.said("success"), [
    "Apple now sends this app's server notifications to Superwall.",
  ]);
});

test("set asks for the revenue provider only when told to, even when the URL is already there", async () => {
  const fresh = await url({ value: "set", app: "8", "set-revenue-provider": true });
  assert.deepEqual(fresh.steps()[1], {
    project_id: 5,
    application_id: 8,
    step: "notification_url",
    set_revenue_provider: true,
  });

  const already = await url(
    { value: "set", app: "8", "set-revenue-provider": true },
    { checks: [outcome("already_set")], written: outcome("already_set") },
  );
  assert.equal(already.steps().length, 2);

  const untouched = await url({ value: "set", app: "8" }, { checks: [outcome("already_set")] });
  assert.equal(untouched.steps().length, 1);
  assert.equal(process.exitCode, undefined);
});

test("set never replaces another server's URL", async () => {
  const theirs = "https://example.net/apple";
  const run1 = await url(
    { value: "set", app: "8", "set-revenue-provider": true, json: true },
    { checks: [outcome("conflict", { sandbox_url: theirs })] },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run1.steps(), [
    { project_id: 5, application_id: 8, step: "check_notification_url" },
  ]);
  assert.equal(
    run1.steps().some((body) => "replace_notification_url" in (body as object)),
    false,
  );
  assert.equal((run1.result.json as { apple: { status: string } }).apple.status, "conflict");
});

test("waits for a key Apple has only just created, then gives up with its message", async () => {
  const waiting = outcome("failed", { message: "Apple hasn’t accepted the new key yet.", retryable: true });
  const run1 = await url(
    { value: "set", app: "8" },
    { checks: [waiting, waiting, outcome("not_set")] },
  );
  assert.deepEqual(run1.sleeps, [5000, 10_000]);
  assert.equal(process.exitCode, undefined);

  const never = await url({ value: "check", app: "8" }, { checks: Array(6).fill(waiting) });
  assert.equal(never.sleeps.length, 5);
  assert.equal(process.exitCode, 1);
  assert.deepEqual(never.result.said("error"), ["Apple hasn’t accepted the new key yet."]);
});

test("an API key, or an API without the check, is refused clearly and nothing is written", async () => {
  const key = await url(
    { value: "set", app: "8" },
    {
      failCheck: new ApiError(
        "POST /x",
        500,
        '{"message":"Apple setup requires an authenticated user session."}',
      ),
    },
  );
  assert.equal(process.exitCode, 1);
  assert.match(key.result.said("error")[0] ?? "", /Run `superwall login`, then try again/);
  assert.equal(key.steps().length, 1);

  for (const failure of [
    new ApiError("POST /x", 400, '{"message":"Expected check_notification_url"}'),
    new ApiError("POST /x", 404, ""),
  ]) {
    const old = await url({ value: "set", app: "8" }, { failCheck: failure });
    assert.match(old.result.said("error")[0] ?? "", /can't check Apple's server notification URL yet/);
    assert.equal(old.steps().length, 1);
  }

  const other = await url(
    { value: "check", app: "8" },
    { failCheck: new ApiError("POST /x", 403, '{"message":"Forbidden"}') },
  );
  assert.deepEqual(other.result.said("error").map((line) => line.split("\n")[0]), ["Forbidden"]);

  const empty = await url(
    { value: "check", app: "8" },
    { routes: (method, path) => (path.endsWith(STEP) ? { notification_url: null } : undefined) },
  );
  assert.match(empty.result.said("error")[0] ?? "", /didn't say what Apple has/);
});

test("--dry-run on set says what it would write and writes nothing", async () => {
  const human = await url({ value: "set", app: "8", dryRun: true });
  assert.deepEqual(human.result.said("info"), [
    `[dry-run] would set ${OURS} where Apple has no server notification URL.`,
  ]);
  assert.deepEqual(human.steps(), []);
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
