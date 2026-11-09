import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { runLifecycle } from "@/program/lifecycle";
import { writeOrigin } from "@/core/paywalls/project/lock";
import { runPaywallMigration, runProviderMigration, runScreenMigration } from "@/core/workflows/migrate";
import { prompted, type Answers } from "../../helpers/answers";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { clearHomes, useHome } from "../../helpers/home";
import {
  clearLoginHosts,
  expoApp,
  restoreSandboxPath,
  runWorkflow,
  useAgents,
  useLoginHosts,
  useSandboxPath,
} from "../../helpers/workflow";

afterEach(() => {
  clearHomes();
});

const FIXTURES = path.resolve("tests/fixtures/screens");

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
}

const appWithScreen = (name: string): string => {
  const root = scratch(name);
  fs.mkdirSync(path.join(root, "App"), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, "UpdateRequiredView.swift"), path.join(root, "App", "UpdateRequiredView.swift"));
  return root;
};

async function migrateWithoutPath(installDir: string, skill = false) {
  const calls: RendererCall[] = [];
  const before = process.exitCode;
  await runLifecycle(
    { name: "migrate", auth: "none", json: false, prompts: true },
    { flags: { installDir }, interactive: false },
    { renderer: () => recordingRenderer(calls), nonInteractive: true, waitForPaint: false },
    (ctx) => runScreenMigration(ctx, { path: "", screenshot: undefined }, skill),
  );
  const failed = process.exitCode !== undefined && process.exitCode !== 0 && process.exitCode !== before;
  process.exitCode = before;
  return { calls, failed };
}

const text = (calls: RendererCall[], method: string) =>
  calls.filter((call) => call.method === method).map((call) => String(call.value)).join("\n");

test("a screen migration with no path and --skill needs the path", async () => {
  const { calls, failed } = await migrateWithoutPath(appWithScreen("screen-skill-no-path"), true);
  assert.equal(failed, true);
  assert.match(text(calls, "error"), /`--skill` needs the screen/);
});

test("a screen migration with no path lists the likely screens when nobody can pick", async () => {
  const root = appWithScreen("screen-list");
  fs.writeFileSync(path.join(root, "App", "Helpers.swift"), "func helper() {}");
  const { calls, failed } = await migrateWithoutPath(root);
  assert.equal(failed, false, text(calls, "error"));
  const list = calls.find((call) => call.method === "list")?.value as {
    items: Array<{ label: string; meta?: string }>;
  };
  assert.deepEqual(list.items.map((item) => item.label), ["App/UpdateRequiredView.swift"]);
  assert.match(list.items[0]?.meta ?? "", /update-required/);
  assert.match(text(calls, "info"), /Pass one: `superwall migrate --screen <path>`/);
  assert.equal(fs.existsSync(path.join(root, "superwall")), false);
});

test("a screen migration with no path and nothing screen-like says so", async () => {
  const root = scratch("screen-none");
  fs.writeFileSync(path.join(root, "README.md"), "# nothing");
  const { calls, failed } = await migrateWithoutPath(root);
  assert.equal(failed, true);
  assert.match(text(calls, "error"), /No screen-like files found under .* — pass one/);
});

const migrateScreen = (installDir: string, screen: { path: string; screenshot?: string }, answers?: Answers) =>
  runWorkflow((ctx) => runScreenMigration(ctx, { path: screen.path, screenshot: screen.screenshot }, false), {
    installDir,
    answers,
  });

const migrateProvider = (installDir: string, options: { answers?: Answers; dryRun?: boolean } = {}) =>
  runWorkflow((ctx) => runProviderMigration(ctx), { installDir, ...options });

describe("in a terminal", () => {
  beforeEach(() => {
    useSandboxPath();
  });

  afterEach(() => {
    mock.restoreAll();
    restoreFetch();
    restoreSandboxPath();
    clearLoginHosts();
    delete process.env.SUPERWALL_API_KEY;
  });

  test("a screen migration with no path asks which screen, then leaves the rebuild for later", async () => {
    useHome();
    useFetch([]);
    useAgents({});
    const root = appWithScreen("screen-pick");
    const { calls, failed } = await migrateScreen(root, { path: "" }, { select: ["App/UpdateRequiredView.swift", "later"] });
    assert.equal(failed, false, text(calls, "error"));
    assert.deepEqual(prompted(calls, "select"), ["Which screen should ship through Superwall?", "Rebuild the pages now?"]);
    assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "update-required", "MIGRATION.md")));
    assert.equal(calls.filter((call) => call.method === "note").length > 0, true);
    assert.match(text(calls, "outro"), /^Done\./);
  });

  test("a screen migration whose screen question is dismissed stops", async () => {
    useHome();
    useFetch([]);
    const root = appWithScreen("screen-dismiss");
    const { calls, failed } = await migrateScreen(root, { path: "" }, { select: [null] });
    assert.equal(failed, false);
    assert.equal(fs.existsSync(path.join(root, "superwall")), false);
    assert.equal(text(calls, "outro"), "");
  });

  test("a screen migration with a screenshot that isn't there is refused", async () => {
    useHome();
    const root = appWithScreen("screen-shot");
    const { calls, failed } = await migrateScreen(root, { path: path.join(root, "App", "UpdateRequiredView.swift"), screenshot: "nope.png" });
    assert.equal(failed, true);
    assert.match(text(calls, "error"), /No screenshot at `nope\.png`\./);
  });

  test("a screen migration rebuilt by the agent asks about the studio, and declining it ends the run", async () => {
    useHome();
    useFetch([]);
    const runs = useAgents({ claude: [{ ok: true, finalText: "Rebuilt the screen." }] });
    const root = appWithScreen("screen-agent");
    const { calls, failed } = await migrateScreen(root, { path: path.join(root, "App", "UpdateRequiredView.swift") }, { select: ["agent"], confirm: [false] });
    assert.equal(failed, false, text(calls, "error"));
    assert.equal(runs.length, 1);
    assert.deepEqual(prompted(calls, "confirm"), ["Open the studio now, on paywall/update-required?"]);
    assert.match(text(calls, "report"), /Rebuilt the screen\./);
  });

  test("a screen migration dry run reports the plan and writes nothing, asking for no screenshot", async () => {
    useHome();
    useFetch([]);
    const runs = useAgents({ claude: [] });
    const root = appWithScreen("screen-dry");
    const { calls, failed } = await runWorkflow(
      (ctx) => runScreenMigration(ctx, { path: path.join(root, "App", "UpdateRequiredView.swift"), screenshot: undefined }, false),
      { installDir: root, answers: {}, dryRun: true },
    );
    assert.equal(failed, false, text(calls, "error"));
    assert.equal(fs.existsSync(path.join(root, "superwall")), false);
    assert.deepEqual(prompted(calls, "select"), []);
    assert.deepEqual(prompted(calls, "confirm"), []);
    assert.deepEqual(prompted(calls, "text"), []);
    assert.equal(runs.length, 0);
    assert.match(text(calls, "step"), /Would create a superwall project in superwall/);
    assert.match(text(calls, "step"), /Would create superwall\/paywalls\/update-required/);
    assert.equal(text(calls, "outro"), "Dry run - no changes made.");
  });

  test("a screen migration dry run still refuses a missing screenshot", async () => {
    useHome();
    const root = appWithScreen("screen-dry-shot");
    const { calls, failed } = await runWorkflow(
      (ctx) => runScreenMigration(ctx, { path: path.join(root, "App", "UpdateRequiredView.swift"), screenshot: "nope.png" }, false),
      { installDir: root, dryRun: true },
    );
    assert.equal(failed, true);
    assert.match(text(calls, "error"), /No screenshot at `nope\.png`\./);
    assert.equal(fs.existsSync(path.join(root, "superwall")), false);
  });

  test("a screen migration dry run on a scaffolded screen offers no rebuild and runs no agent", async () => {
    useHome();
    useFetch([]);
    const runs = useAgents({ claude: [] });
    const root = appWithScreen("screen-dry-again");
    const file = path.join(root, "App", "UpdateRequiredView.swift");
    await migrateScreen(root, { path: file });
    const lock = fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8");
    const { calls, failed } = await runWorkflow((ctx) => runScreenMigration(ctx, { path: file, screenshot: undefined }, false), {
      installDir: root,
      answers: {},
      dryRun: true,
    });
    assert.equal(failed, false, text(calls, "error"));
    assert.match(text(calls, "info"), /`paywalls\/update-required` was scaffolded from/);
    assert.deepEqual(prompted(calls, "select"), []);
    assert.deepEqual(prompted(calls, "confirm"), []);
    assert.equal(runs.length, 0);
    assert.equal(fs.readFileSync(path.join(root, "superwall", "superwall.lock"), "utf8"), lock);
    assert.equal(text(calls, "outro"), "Dry run - no changes made.");
  });

  test("a paywall migration dry run reads the paywall, reports the plan and writes nothing", async () => {
    useHome({ authMethod: "api_key", apiKey: "sk_live_x", orgName: "Acme Inc", userEmail: "ana@acme.dev" });
    const log = useFetch([
      {
        match: "/v2/paywalls/255456",
        body: { id: 255456, name: "Force Update", application_id: 42, application_platform: "ios", paywall_url: "https://runtime.example/store/document/abc" },
      },
      { match: "runtime.example/store/document/abc", text: fs.readFileSync(path.resolve("tests/fixtures/origin/force-update.html"), "utf8") },
    ]);
    const runs = useAgents({ claude: [] });
    const root = scratch("paywall-dry");
    const { calls, failed } = await runWorkflow((ctx) => runPaywallMigration(ctx, "255456", false), {
      installDir: root,
      dryRun: true,
    });
    assert.equal(failed, false, text(calls, "error"));
    assert.equal(fs.existsSync(path.join(root, "superwall")), false);
    assert.equal(runs.length, 0);
    assert.deepEqual(log.map((entry) => entry.method), ["GET", "GET"]);
    assert.match(text(calls, "step"), /Would create superwall\/paywalls\/force-update from `Force Update`/);
    assert.match(text(calls, "step"), /Would record paywall 255456 in superwall\.lock/);
    assert.match(text(calls, "step"), /Would save app 42 for ios in superwall\.lock/);
    assert.equal(text(calls, "outro"), "Dry run - no changes made.");
  });

  test("a paywall migration dry run fails like the real run when the paywall has no served document", async () => {
    useHome({ authMethod: "api_key", apiKey: "sk_live_x", orgName: "Acme Inc", userEmail: "ana@acme.dev" });
    useFetch([{ match: "/v2/paywalls/255456", body: { id: 255456, name: "Force Update" } }]);
    const runs = useAgents({ claude: [] });
    const root = scratch("paywall-dry-no-document");
    const { calls, failed } = await runWorkflow((ctx) => runPaywallMigration(ctx, "255456", false), {
      installDir: root,
      dryRun: true,
    });
    assert.equal(failed, true);
    assert.match(text(calls, "error"), /Paywall 255456 has no served document to rebuild from/);
    assert.doesNotMatch(text(calls, "outro"), /Dry run - no changes made\./);
    assert.equal(fs.existsSync(path.join(root, "superwall")), false);
    assert.equal(runs.length, 0);
  });

  test("the provider migration needs a coding agent and an app", async () => {
    useHome();
    useAgents({});
    const none = await migrateProvider(expoApp());
    assert.equal(none.failed, true);
    assert.match(text(none.calls, "error"), /No coding agent found \(Claude Code or Codex\)\./);

    useAgents({ claude: [] });
    const empty = await migrateProvider(fs.mkdtempSync(path.join(os.tmpdir(), "sw-migrate-empty-")));
    assert.equal(empty.failed, true);
    assert.match(text(empty.calls, "error"), /No iOS \/ Android \/ Expo \/ React Native \/ Flutter app found here\./);
  });

  test("the provider migration with no provider in the app says to integrate instead", async () => {
    useHome();
    const runs = useAgents({ claude: [] });
    const { calls, failed } = await migrateProvider(expoApp(), { answers: {} });
    assert.equal(failed, false);
    assert.deepEqual(runs, []);
    assert.equal(text(calls, "warn"), "No RevenueCat / Adapty / Qonversion detected - nothing to migrate.");
    assert.match(text(calls, "info"), /Starting fresh\? Run `superwall integrate`/);
  });

  test("the provider migration asks how far to go, and dismissing that cancels", async () => {
    useHome();
    useAgents({ claude: [] });
    const { calls } = await migrateProvider(expoApp({}, { "react-native-purchases": "7.0.0" }), { answers: { select: [null] } });
    assert.match(text(calls, "info"), /Found `RevenueCat`/);
    assert.deepEqual(prompted(calls, "select"), ["Migrate from RevenueCat - how far?"]);
    assert.equal(text(calls, "warn"), "Cancelled.");
  });

  test("a provider migration dry run shows the plan for Adapty and Qonversion alike", async () => {
    useHome();
    useAgents({ codex: [] });
    for (const [dependency, provider] of [["react-native-adapty", "Adapty"], ["react-native-qonversion", "Qonversion"]]) {
      const { calls } = await migrateProvider(expoApp({}, { [dependency!]: "1.0.0" }), { dryRun: true });
      const plan = calls.find((call) => call.method === "note")?.value as { value: string; title: string };
      assert.equal(plan.title, "Migration plan");
      assert.match(plan.value, new RegExp(`^Provider:  ${provider}\nMode:      full\nApp:       Acme \\(Expo \\(React Native\\)\\)`));
      assert.equal(text(calls, "outro"), "Dry run - no changes made.");
    }
  });

  test("a headless provider migration signed in with an API key runs the agent and keeps its report", async () => {
    useHome({ authMethod: "api_key", apiKey: "sk_live_x", orgName: "Acme Inc", userEmail: "ana@acme.dev" });
    useFetch([]);
    const runs = useAgents({ claude: [{ ok: true, finalText: "[STATUS] done\nMoved 3 products." }] });
    const app = expoApp({}, { "react-native-purchases": "7.0.0" });
    const { calls, failed } = await migrateProvider(app);
    assert.equal(failed, false, text(calls, "error"));
    assert.equal(text(calls, "success"), "Logged in as `ana@acme.dev` · `Acme Inc`");
    assert.match(runs[0]?.options.prompt ?? "", /RevenueCat/);
    assert.equal(process.env.SUPERWALL_API_KEY, "sk_live_x");
    assert.equal(fs.readFileSync(path.join(app, ".superwall", "migrate.md"), "utf8"), "Moved 3 products.");
    assert.match(text(calls, "spinner.stop"), /Migration complete/);
    assert.match(text(calls, "outro"), /^Done\./);
  });

  test("a provider migration in a terminal logs in first, and an agent that stops early fails it", async () => {
    useHome();
    useLoginHosts();
    useFetch([{ match: "/.well-known/openid-configuration", status: 500, body: {} }]);
    useAgents({ claude: [{ ok: false, finalText: "Out of room." }] });
    const { calls, failed } = await migrateProvider(expoApp({}, { "react-native-purchases": "7.0.0" }), { answers: { select: ["paywalls"] } });
    assert.equal(failed, true);
    assert.match(text(calls, "spinner.stop"), /Login failed[\s\S]*Migration stopped early/);
    assert.match(text(calls, "report"), /Out of room\./);
    assert.match(text(calls, "error"), /Migration did not complete\./);

    useHome({ authMethod: "oauth", accessToken: "t", refreshToken: "r", accessTokenExpiresAt: Date.now() + 3_600_000 });
    useAgents({ claude: [{ ok: false }, { ok: true }] });
    const quiet = await migrateProvider(expoApp({}, { "react-native-purchases": "7.0.0" }), { answers: { select: ["full"] } });
    assert.equal(quiet.failed, true);
    assert.equal(text(quiet.calls, "report"), "");
    assert.equal(text(quiet.calls, "success"), "Logged in as `you`");

    const silent = await migrateProvider(expoApp({}, { "react-native-purchases": "7.0.0" }), { answers: { select: ["full"] } });
    assert.equal(silent.failed, false);
    assert.equal(text(silent.calls, "report"), "");
  });

  test("a provider migration falls back to the next agent when the first runs out of usage", async () => {
    useHome();
    useFetch([]);
    const runs = useAgents({ claude: [{ ok: false, failureReason: "usage-limit" }], codex: [{ ok: true }] });
    const { failed } = await migrateProvider(expoApp({}, { "react-native-purchases": "7.0.0" }));
    assert.equal(failed, false);
    assert.deepEqual(runs.map((run) => run.driver), ["claude", "codex"]);
  });

  test("a paywall migration dry run on a scaffolded paywall offers no rebuild and runs no agent", async () => {
    useHome();
    useFetch([]);
    const runs = useAgents({ claude: [] });
    const root = scratch("paywall-dry-again");
    const dir = path.join(root, "superwall");
    fs.mkdirSync(path.join(dir, "paywalls", "force-update"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { superwall: "latest" } }));
    fs.writeFileSync(path.join(dir, "paywalls", "force-update", "MIGRATION.md"), "# brief\n- Pages: 1\n");
    writeOrigin(dir, "paywall", "force-update", { paywallId: "255456", url: "https://runtime.example/store/document/abc" });
    const { calls, failed } = await runWorkflow((ctx) => runPaywallMigration(ctx, "255456", false), {
      installDir: root,
      answers: {},
      dryRun: true,
    });
    assert.equal(failed, false, text(calls, "error"));
    assert.deepEqual(prompted(calls, "select"), []);
    assert.deepEqual(prompted(calls, "confirm"), []);
    assert.equal(runs.length, 0);
    assert.equal(text(calls, "outro"), "Dry run - no changes made.");
  });

  test("a scaffolded paywall rebuilt by the agent asks about the studio, and declining it ends the run", async () => {
    useHome();
    useFetch([]);
    const runs = useAgents({ claude: [{ ok: true }] });
    const root = scratch("paywall-agent");
    const dir = path.join(root, "superwall");
    fs.mkdirSync(path.join(dir, "paywalls", "force-update"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { superwall: "latest" } }));
    fs.writeFileSync(path.join(dir, "paywalls", "force-update", "MIGRATION.md"), "# brief\n- Pages: 1\n");
    writeOrigin(dir, "paywall", "force-update", { paywallId: "255456", url: "https://runtime.example/store/document/abc" });
    const { calls, failed } = await runWorkflow((ctx) => runPaywallMigration(ctx, "255456", false), {
      installDir: root,
      answers: { select: ["agent"], confirm: [false] },
    });
    assert.equal(failed, false, text(calls, "error"));
    assert.equal(runs[0]?.options.cwd, dir);
    assert.match(text(calls, "info"), /`paywalls\/force-update` was scaffolded from paywall 255456/);
    assert.deepEqual(prompted(calls, "confirm"), ["Open the studio now, on paywall/force-update next to the original?"]);
    assert.match(text(calls, "outro"), /^Done\./);
  });
});
