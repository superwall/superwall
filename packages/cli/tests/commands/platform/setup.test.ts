import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setupApple } from "@/commands/platform/apple";
import { runSetup } from "@/commands/platform/setup";
import { ApiError } from "@/core/api/client";
import { AppleError, type AppleTeam } from "@/core/apple/session";
import {
  ACME,
  IOS_APP,
  OURS,
  PEM,
  PENDING,
  outcome,
  scenario as appleScenario,
  type Scenario,
} from "../../helpers/apple-setup";
import { run } from "../../helpers/command";

afterEach(() => {
  process.exitCode = undefined;
});

const scenario = (options: Scenario = {}) =>
  appleScenario("setup", setupApple, { ...options, argv: { target: "apple", ...options.argv } });

test("connects an app end to end without prompts", async () => {
  const run = await scenario({ argv: { json: true } });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.result.json, {
    status: "ok",
    team: ACME,
    app: { id: "8", project_id: "5", name: "Acme", bundle_id: "com.acme.app", created: false },
    steps: {
      api_key: { status: "done", detail: "TEAMKEY001" },
      purchase_key: { status: "done", detail: "IAPKEY0001" },
      notification_url: { status: "done", detail: "set" },
    },
    notification_url: OURS,
    failed: [],
  });
  assert.deepEqual(run.log, [
    "signIn jane@example.com",
    "iris POST /apiKeys",
    "iris GET /apiKeys/TEAMKEY001",
    "iris POST /subscriptionKeys",
    "iris GET /subscriptionKeys/IAPKEY0001",
  ]);
  assert.equal(run.wrote("POST", "/v2/organizations").length, 0);
  assert.equal(run.wrote("PATCH", "/v2/organizations").length, 0);
  assert.deepEqual(run.wrote("PUT", "/app-store-connect/configuration")[0]?.body, {
    key_id: "TEAMKEY001",
    issuer_id: "issuer-111",
    private_key: PEM,
  });
  assert.deepEqual(run.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.app",
    key_id: "IAPKEY0001",
    issuer_id: "issuer-111",
    private_key: PEM,
  });
  assert.deepEqual(
    run.wrote("POST", "/apple-setup/run-step").map((request) => request.body),
    [
      { project_id: 5, application_id: 8, step: "check_notification_url" },
      { project_id: 5, application_id: 8, step: "notification_url" },
    ],
  );
  assert.deepEqual(run.files, {});
  assert.deepEqual(
    run.calls.map((call) => call.method),
    ["start", "stop"],
  );
});

test("human output ends with a report and a success line", async () => {
  const run = await scenario();
  assert.deepEqual(run.said("report"), [
    "✓ App Store Connect API key  TEAMKEY001\n✓ In-App Purchase key  IAPKEY0001\n✓ Server notification URL  set",
  ]);
  assert.deepEqual(run.said("success"), ["Apple is connected for `Acme`."]);
});

test("without prompts, stops for a verification code, then continues from the saved sign-in", async () => {
  const first = await scenario({ apple: { twoFactor: true }, argv: { json: true } });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(first.result.json, {
    status: "verification_required",
    method: "device",
    destination: null,
    next: "superwall setup apple --code <code>",
  });
  assert.deepEqual(first.pending(), PENDING);
  assert.deepEqual(first.log, ["signIn jane@example.com", "requestCode device"]);
  assert.equal(first.requests.some((request) => request.method !== "GET"), false);

  process.exitCode = undefined;
  const second = await scenario({
    apple: { twoFactor: true },
    argv: { json: true, code: "123456" },
    stored: first.pending(),
    credentials: {},
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(second.sessions, [PENDING]);
  assert.equal(second.log[0], "submitCode 123456");
  assert.equal(second.pending(), undefined);
  assert.equal((second.result.json as { status: string }).status, "ok");
});

test("a text message can be requested for a saved sign-in", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { sms: true },
    stored: PENDING,
    credentials: {},
  });
  assert.deepEqual(run.log, ["requestCode sms"]);
  assert.match(run.said("warn")[0] ?? "", /Apple texted a code to •••42\./);
  assert.match(run.said("warn")[0] ?? "", /with the same flags within 10 minutes/);
  assert.equal(process.exitCode, 1);
});

test("a wrong code without prompts keeps the sign-in so it can be retried", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { code: "000000" },
    stored: PENDING,
    credentials: {},
  });
  assert.equal(process.exitCode, 1);
  assert.match(run.said("error")[0] ?? "", /Apple didn't accept that code/);
  assert.deepEqual(run.pending(), PENDING);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
});

test("a code generated ahead of time works in a single run", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { json: true, code: "123456" },
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.log.slice(0, 3), [
    "signIn jane@example.com",
    "requestCode device",
    "submitCode 123456",
  ]);
  assert.equal((run.result.json as { status: string }).status, "ok");
});

test("a saved sign-in for another Apple Account is not reused", async () => {
  const run = await scenario({
    argv: { "apple-id": "other@example.com", code: "123456", json: true },
    stored: PENDING,
  });
  assert.deepEqual(run.sessions, [undefined]);
  assert.equal(run.log[0], "signIn other@example.com");
});

test("flags win over the environment for the Apple Account", async () => {
  const run = await scenario({
    argv: { "apple-id": "other@example.com", "apple-password": "from-flag", json: true },
    credentials: {},
  });
  assert.equal(run.log[0], "signIn other@example.com");
  assert.equal((run.result.json as { status: string }).status, "ok");
});

test("needs an email and password when it cannot prompt", async () => {
  const run = await scenario({ credentials: {} });
  assert.match(run.said("error")[0] ?? "", /Can't prompt for Apple sign-in here/);
  assert.match(run.said("error")[0] ?? "", /SUPERWALL_APPLE_PASSWORD/);
  assert.match(run.said("error")[0] ?? "", /If you are an agent, never ask for the password in chat/);
  assert.match(run.said("error")[0] ?? "", /Open it in the user's text editor/);
  assert.equal(run.log.length, 0);
});

test("prompts for the account, then the code, and can switch to a text", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { app: "8" },
    credentials: {},
    interactive: true,
    answers: { text: ["jane@example.com", "hunter2", "sms", "000000", "123456"] },
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.log.slice(0, 5), [
    "signIn jane@example.com",
    "requestCode device",
    "requestCode sms",
    "submitCode 000000",
    "submitCode 123456",
  ]);
  const prompts = run.calls
    .filter((call) => call.method === "text")
    .map((call) => call.value as { message: string; secret?: boolean });
  assert.deepEqual(
    prompts.map((prompt) => [prompt.message, prompt.secret === true]),
    [
      ["Apple Account email", false],
      ["Apple Account password", true],
      ["Verification code", false],
      ["Verification code", false],
      ["Verification code", false],
    ],
  );
  assert.match(run.said("warn")[0] ?? "", /didn't accept that code/);
});

test("gives up after three wrong codes at the prompt", async () => {
  const run = await scenario({
    apple: { twoFactor: true },
    argv: { app: "8" },
    interactive: true,
    answers: { text: ["1", "2", "3"] },
  });
  assert.equal(process.exitCode, 1);
  assert.equal(run.log.filter((line) => line.startsWith("submitCode")).length, 3);
});

test("cancelling a prompt stops before anything is created", async () => {
  for (const text of [[null], ["jane@example.com", null]]) {
    const run = await scenario({
      argv: { app: "8" },
      credentials: {},
      interactive: true,
      answers: { text },
    });
    assert.deepEqual(run.said("error"), ["Cancelled."]);
    assert.equal(run.log.length, 0);
  }
  const code = await scenario({
    apple: { twoFactor: true },
    argv: { app: "8" },
    interactive: true,
    answers: { text: [null] },
  });
  assert.deepEqual(code.said("error"), ["Cancelled."]);
});

test("refuses to replace a server notification URL another server holds", async () => {
  const theirs = "https://api.revenuecat.com/v1/incoming-webhooks/apple";
  const run = await scenario({
    api: { checks: [outcome("conflict", { production_url: theirs })] },
  });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(
    run.wrote("POST", "/apple-setup/run-step").map((request) => (request.body as { step: string }).step),
    ["check_notification_url"],
  );
  assert.match(run.said("error")[0] ?? "", /another server. Superwall won't replace it/);
  assert.match(run.said("error")[0] ?? "", new RegExp(`Production: ${theirs}`));
  assert.match(run.said("error")[0] ?? "", /clear it in App Store Connect/);
  assert.match(run.said("report")[0] ?? "", /✗ Server notification URL  not done/);
  assert.match(run.said("warn").at(-1) ?? "", /Partly done/);

  process.exitCode = undefined;
  const json = await scenario({
    api: { checks: [outcome("conflict", { sandbox_url: theirs })] },
    argv: { json: true },
  });
  const body = json.result.json as { status: string; failed: string[] };
  assert.equal(body.status, "partial");
  assert.deepEqual(body.failed, ["notification_url"]);
});

test("leaves a URL Superwall says is already this app's alone, and never asks for the provider", async () => {
  const run = await scenario({ api: { checks: [outcome("already_set")] }, argv: { json: true } });
  assert.deepEqual(
    run.wrote("POST", "/apple-setup/run-step").map((request) => request.body),
    [{ project_id: 5, application_id: 8, step: "check_notification_url" }],
  );
  assert.deepEqual(
    (run.result.json as { steps: { notification_url: unknown } }).steps.notification_url,
    { status: "done", detail: "already set" },
  );
});

test("waits while Apple has not accepted a new key for the notification URL", async () => {
  const run = await scenario({
    api: {
      checks: [
        outcome("failed", { message: "Apple hasn’t accepted the new key yet.", retryable: true }),
        outcome("not_set"),
      ],
    },
    argv: { json: true },
  });
  assert.deepEqual(run.sleeps, [5000]);
  assert.equal((run.result.json as { status: string }).status, "ok");
});

test("an app that already has a key gets no second one", async () => {
  const run = await scenario({
    api: {
      saved: {
        app_store_connect_configuration: { key_id: "OLDKEY0001", issuer_id: "issuer-111", has_private_key: true },
      },
    },
    argv: { json: true },
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.log, [
    "signIn jane@example.com",
    "iris POST /subscriptionKeys",
    "iris GET /subscriptionKeys/IAPKEY0001",
  ]);
  assert.equal(run.wrote("PUT", "/app-store-connect/configuration").length, 0);
  assert.deepEqual((run.result.json as { steps: { api_key: unknown } }).steps.api_key, {
    status: "done",
    detail: "OLDKEY0001 (already saved)",
  });
});

test("a refused In-App Purchase key leaves the rest done and exits non-zero", async () => {
  const run = await scenario({
    apple: { refuse: { subscriptionKeys: new AppleError("forbidden", "does not allow this request", 403) } },
    argv: { json: true },
  });
  assert.equal(process.exitCode, 1);
  const body = run.result.json as {
    failed: string[];
    steps: Record<string, { status: string; detail?: string }>;
  };
  assert.deepEqual(body.failed, ["purchase_key"]);
  assert.equal(body.steps.api_key?.status, "done");
  assert.equal(body.steps.notification_url?.status, "done");
  assert.match(body.steps.purchase_key?.detail ?? "", /Admin or the Account Holder/);
});

test("a refused team key explains the limit or the role, and still tries the rest", async () => {
  const limit = await scenario({
    apple: { refuse: { apiKeys: new AppleError("request", "Maximum number of active keys", 409) } },
    argv: { json: true },
  });
  const body = limit.result.json as { steps: Record<string, { status: string; detail?: string }> };
  assert.match(body.steps.api_key?.detail ?? "", /limit of active keys/);
  assert.equal(body.steps.purchase_key?.status, "done");

  process.exitCode = undefined;
  const other = await scenario({
    apple: { refuse: { apiKeys: new AppleError("request", "Server busy", 500) } },
    api: { checks: [outcome("skipped")] },
    argv: { json: true },
  });
  const otherBody = other.result.json as { steps: Record<string, { status: string; detail?: string }> };
  assert.equal(otherBody.steps.api_key?.detail, "Apple refused: Server busy");
  assert.match(otherBody.steps.notification_url?.detail ?? "", /no App Store Connect API key saved/);
  assert.deepEqual(
    other.wrote("POST", "/apple-setup/run-step").map((request) => (request.body as { step: string }).step),
    ["check_notification_url"],
  );
});

test("waits for Apple to activate a new key, then keeps it on disk if it never does", async () => {
  const slow = await scenario({
    api: { appVerdicts: [{ valid: false, error: "401" }, { valid: false, error: "401" }] },
    argv: { json: true },
  });
  assert.deepEqual(slow.sleeps, [2000, 4000]);
  assert.equal((slow.result.json as { status: string }).status, "ok");

  process.exitCode = undefined;
  const never = await scenario({
    api: { purchaseVerdict: { valid: false, error: "Invalid key" } },
  });
  assert.equal(process.exitCode, 1);
  assert.equal(never.sleeps.length, 7);
  assert.deepEqual(never.files, { "SubscriptionKey_IAPKEY0001.p8": PEM });
  assert.match(never.said("warn")[0] ?? "", /saved to \/tmp\/SubscriptionKey_IAPKEY0001\.p8/);
});

test("a key Superwall cannot save is kept on disk", async () => {
  const run = await scenario({
    api: { failAppSave: new ApiError("PUT /x", 500, '{"message":"boom"}') },
    argv: { json: true },
  });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run.files, { "AuthKey_TEAMKEY001.p8": PEM });
  assert.deepEqual(run.sleeps, []);
  const body = run.result.json as { steps: Record<string, { status: string; detail?: string }> };
  assert.match(body.steps.api_key?.detail ?? "", /Superwall couldn't save the key: boom/);
});

test("a notification URL Superwall cannot check is reported, not thrown", async () => {
  const refused = await scenario({
    api: { failCheck: new ApiError("POST /x", 409, '{"message":"not allowed"}') },
    argv: { json: true },
  });
  const body = refused.result.json as { steps: Record<string, { detail?: string }> };
  assert.equal(body.steps.notification_url?.detail, "not allowed");

  process.exitCode = undefined;
  const old = await scenario({
    api: { failCheck: new ApiError("POST /x", 400, '{"message":"Expected a step"}') },
  });
  assert.equal(process.exitCode, 1);
  assert.match(old.said("warn")[0] ?? "", /can't check Apple's server notification URL yet/);
  assert.equal(
    old.wrote("POST", "/apple-setup/run-step").some(
      (request) => (request.body as { step: string }).step === "notification_url",
    ),
    false,
  );

  process.exitCode = undefined;
  const key = await scenario({
    api: {
      failCheck: new ApiError(
        "POST /x",
        500,
        '{"message":"Apple setup requires an authenticated user session."}',
      ),
    },
  });
  assert.match(key.said("warn")[0] ?? "", /for a signed-in person, not an API key/);
});

test("skip flags leave each step alone", async () => {
  const run = await scenario({
    argv: { json: true, "skip-api-key": true, "skip-purchase-key": true, "skip-notification-url": true },
  });
  assert.deepEqual(run.log, ["signIn jane@example.com"]);
  assert.equal(run.requests.some((request) => request.method !== "GET"), false);
  assert.deepEqual((run.result.json as { steps: unknown }).steps, {
    api_key: { status: "skipped" },
    purchase_key: { status: "skipped" },
    notification_url: { status: "skipped" },
  });
});

test("picks the Apple team by flag, and asks for one when there are several", async () => {
  const teams = [ACME, { id: 222, issuerId: "issuer-222", name: "Side Project" }];
  const missing = await scenario({ apple: { teams } });
  assert.match(missing.said("error")[0] ?? "", /several teams: 111 \(Acme Inc\), 222 \(Side Project\)/);

  process.exitCode = undefined;
  const named = await scenario({ apple: { teams }, argv: { team: "side project", json: true } });
  assert.ok(named.log.includes("selectTeam 222"));
  assert.equal((named.result.json as { team: AppleTeam }).team.id, 222);

  process.exitCode = undefined;
  const unknown = await scenario({ apple: { teams }, argv: { team: "999" } });
  assert.match(unknown.said("error")[0] ?? "", /isn't on team 999/);

  process.exitCode = undefined;
  const picked = await scenario({
    apple: { teams },
    interactive: true,
    answers: { select: ["222"] },
    argv: { app: "8" },
  });
  assert.ok(picked.log.includes("selectTeam 222"));

  process.exitCode = undefined;
  const cancelled = await scenario({ apple: { teams }, interactive: true, argv: { app: "8" } });
  assert.deepEqual(cancelled.said("error"), ["Cancelled."]);
});

test("--dry-run signs in and checks key access without creating anything", async () => {
  const run = await scenario({
    apple: { refuse: {} },
    argv: { dryRun: true, json: true },
  });
  assert.deepEqual(run.result.json, {
    dryRun: true,
    team: ACME,
    access: { api_key: "ok", purchase_key: "ok" },
  });
  assert.deepEqual(run.log, ["signIn jane@example.com", "iris GET /apiKeys", "iris GET /subscriptionKeys"]);
  assert.equal(run.requests.length, 0);

  const human = await scenario({ argv: { dryRun: true } });
  assert.deepEqual(human.said("report"), [
    "✓ App Store Connect API key  ok\n✓ In-App Purchase key  ok",
  ]);
});

test("rejects an unknown key role before signing in", async () => {
  const run = await scenario({ argv: { "key-role": "finance" } });
  assert.deepEqual(run.said("error"), ["--key-role must be app_manager or admin."]);
  assert.equal(run.log.length, 0);
});

test("creates a Superwall app from the App Store Connect app when there is none", async () => {
  const run = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: [] }] },
    argv: { "bundle-id": "com.acme.app", json: true },
  });
  assert.deepEqual(run.wrote("POST", "/v2/projects/5/applications")[0]?.body, {
    name: "Acme",
    platform: "ios",
    bundle_id: "com.acme.app",
  });
  assert.deepEqual((run.result.json as { app: unknown }).app, {
    id: "99",
    project_id: "5",
    name: "Acme",
    bundle_id: "com.acme.app",
    created: true,
  });
});

test("a created app the API does not return stops before anything is created at Apple", async () => {
  const run = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: [] }], createdApps: [] },
    argv: { "bundle-id": "com.acme.app" },
  });
  assert.match(run.said("error")[0] ?? "", /Superwall created Acme but didn't return it/);
  assert.deepEqual(run.log, ["signIn jane@example.com"]);
});

test("creates the project too when the organization has none", async () => {
  const run = await scenario({ api: { projects: [] }, argv: { "bundle-id": "com.acme.app", json: true } });
  assert.deepEqual(run.wrote("POST", "/v2/projects")[0]?.body, { name: "Acme", organization_id: 9 });
  assert.equal((run.result.json as { app: { project_id: string } }).app.project_id, "70");
});

test("app choice errors name what to pass", async () => {
  const none = await scenario({ api: { projects: [{ id: 5, applications: [] }] } });
  assert.match(none.said("error")[0] ?? "", /Pass --bundle-id <id>/);
  assert.equal(none.log.length, 0);

  const several = await scenario({
    api: {
      projects: [
        { id: 5, applications: [IOS_APP, { id: 9, name: "Other", platform: "IOS", bundle_id: "com.acme.other" }] },
      ],
    },
  });
  assert.match(several.said("error")[0] ?? "", /Several iOS apps found: 8 \(Acme\), 9 \(Other\)\. Pass --app <id>/);

  const many = await scenario({
    api: {
      projects: [
        {
          id: 5,
          applications: Array.from({ length: 10 }, (_, index) => ({
            id: index + 1,
            name: `App ${index + 1}`,
            platform: "ios",
          })),
        },
      ],
    },
  });
  assert.match(
    many.said("error")[0] ?? "",
    /8 \(App 8\), and 2 more \(`superwall apps` lists them all\)\. Pass --app <id>/,
  );

  const unknownApp = await scenario({ argv: { app: "404" } });
  assert.deepEqual(unknownApp.said("error"), ["No iOS app 404 in this organization."]);

  const unknownProject = await scenario({ argv: { project: "404" } });
  assert.deepEqual(unknownProject.said("error"), ["No project 404 in this organization."]);
});

test("a bundle ID that is not on the signed-in team stops before anything is created", async () => {
  const apps = [
    { id: "701", attributes: { name: "Other", bundleId: "com.acme.other" } },
    { id: "702", attributes: { name: "Third", bundleId: "com.acme.third" } },
  ];
  for (const projects of [[{ id: 5, applications: [] }], undefined]) {
    const run = await scenario({
      apple: { apps },
      api: { projects },
      argv: projects ? { "bundle-id": "com.acme.app" } : {},
    });
    assert.equal(process.exitCode, 1);
    assert.match(
      run.said("error")[0] ?? "",
      /No App Store Connect app with bundle ID com\.acme\.app on the Apple team "Acme Inc"\. Nothing was created\./,
    );
    assert.match(run.said("error")[0] ?? "", /This team's apps: com\.acme\.other, com\.acme\.third\./);
    assert.deepEqual(run.log, ["signIn jane@example.com"]);
    assert.equal(run.requests.some((request) => request.method !== "GET"), false);
    assert.deepEqual(run.files, {});
  }

  const empty = await scenario({ apple: { apps: [] } });
  assert.match(empty.said("error")[0] ?? "", /This team has no apps yet\./);

  const none = await scenario({
    apple: { apps: [] },
    api: { projects: [{ id: 5, applications: [{ id: 8, name: "Acme", platform: "ios" }] }] },
  });
  assert.match(none.said("error")[0] ?? "", /has no apps in App Store Connect yet/);
});

test("interactively picks an existing app, or creates one from an App Store Connect app", async () => {
  const apps = [IOS_APP, { id: 9, name: "Other", platform: "ios", bundle_id: "com.acme.other" }];
  const existing = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: apps }] },
    interactive: true,
    answers: { select: ["8"] },
  });
  assert.deepEqual(existing.said("success"), ["Apple is connected for `Acme`."]);

  const created = await scenario({
    api: {
      projects: [
        { id: 5, name: "Main", applications: apps },
        { id: 6, name: "Second", applications: [] },
      ],
    },
    interactive: true,
    answers: { select: ["__new__", "555", "6"] },
  });
  assert.equal(created.wrote("POST", "/v2/projects/6/applications").length, 1);

  const cancelled = await scenario({
    api: { projects: [{ id: 5, name: "Main", applications: apps }] },
    interactive: true,
  });
  assert.deepEqual(cancelled.said("error"), ["Cancelled."]);
});

test("an app without a bundle id takes it from the flag or from App Store Connect", async () => {
  const bare = { id: 8, name: "Acme", platform: "ios" };
  const flagged = await scenario({
    api: { projects: [{ id: 5, applications: [bare] }] },
    argv: { app: "8", "bundle-id": "com.acme.app", json: true },
  });
  assert.equal((flagged.result.json as { app: { bundle_id: string } }).app.bundle_id, "com.acme.app");

  const picked = await scenario({
    api: { projects: [{ id: 5, applications: [bare] }] },
    interactive: true,
    answers: { select: ["8", "555"] },
  });
  assert.deepEqual(picked.said("success"), ["Apple is connected for `Acme`."]);

  const unknown = await scenario({ api: { projects: [{ id: 5, applications: [bare] }] } });
  assert.match(unknown.said("error")[0] ?? "", /Pass --bundle-id <id>\. This team's apps: com\.acme\.app/);
});

test("--bundle-id wins over the bundle ID Superwall has for the chosen app, with a warning", async () => {
  const run = await scenario({
    apple: { apps: [{ id: "777", attributes: { name: "Other", bundleId: "com.acme.other" } }] },
    argv: { app: "8", "bundle-id": "com.acme.other" },
  });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run.said("warn"), [
    "Superwall has bundle ID com.acme.app for Acme; using com.acme.other from --bundle-id for Apple.",
  ]);
  assert.deepEqual(run.wrote("PUT", "/in-app-purchase/configuration")[0]?.body, {
    bundle_id: "com.acme.other",
    key_id: "IAPKEY0001",
    issuer_id: "issuer-111",
    private_key: PEM,
  });
});

test("setup only knows apple", async () => {
  const result = await run(runSetup.definition, { argv: { target: "google" }, api: {} });
  assert.deepEqual(result.said("error"), ['Unknown "setup google". Use: setup apple']);
});
