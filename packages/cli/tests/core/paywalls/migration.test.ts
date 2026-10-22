import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, mock, test } from "node:test";
import { ApiError } from "@/core/api/client";
import {
  buildMigrationCopyPrompt,
  buildMigrationPrompt,
  isSuperwallProject,
  migrationCommand,
  migrationFor,
  migrationSource,
  migrationsOf,
  projectDirOf,
  scaffoldFromPaywall,
  scaffoldFromScreen,
} from "@/core/paywalls/migration";
import { readLock, writeOrigin } from "@/core/paywalls/project/lock";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { routedApi, type Reply } from "../../helpers/routed-api";

const dirs: string[] = [];

function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  mock.restoreAll();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ORIGIN = { paywallId: "255456", url: "https://runtime.example/store/document/abc" };

const scaffoldMigration = (superwallDir: string, withBrief = true) => {
  fs.mkdirSync(path.join(superwallDir, "paywalls", "force-update"), { recursive: true });
  writeOrigin(superwallDir, "paywall", "force-update", ORIGIN);
  if (withBrief) {
    fs.writeFileSync(
      path.join(superwallDir, "paywalls", "force-update", "MIGRATION.md"),
      "# Migrating \"Force Update\" to code\n\n- Pages: 2\n",
    );
  }
};

test("a project is recognized by its lock or its superwall dependency, nested or bare", () => {
  const root = scratch("project");
  assert.equal(projectDirOf(root), undefined);

  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "superwall.lock"), "{}");
  assert.equal(projectDirOf(root), path.join(root, "superwall"));

  const bare = scratch("bare");
  fs.writeFileSync(
    path.join(bare, "package.json"),
    JSON.stringify({ dependencies: { superwall: "latest" } }),
  );
  assert.equal(isSuperwallProject(bare), true);
  assert.equal(projectDirOf(bare), bare);

  const other = scratch("other");
  fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "x" }));
  assert.equal(isSuperwallProject(other), false);
});

test("migrations are read from the lock's origins with their briefs", () => {
  const dir = scratch("migrations");
  scaffoldMigration(dir);
  writeOrigin(dir, "funnel", "quiz", { paywallId: "1", url: "https://runtime.example/q" });

  const all = migrationsOf(dir);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0], {
    superwallDir: dir,
    surfaceId: "force-update",
    origin: ORIGIN,
    brief: "# Migrating \"Force Update\" to code\n\n- Pages: 2\n",
  });
  assert.equal(migrationFor(dir, "255456")?.surfaceId, "force-update");
  assert.equal(migrationFor(dir, "999"), undefined);
  assert.equal(migrationsOf(scratch("empty")).length, 0);
});

test("the prompt carries the brief, the bundled playbook, and the source, and the copy form drops the [STATUS] protocol", () => {
  const dir = scratch("prompt");
  scaffoldMigration(dir);
  const migration = migrationFor(dir, "255456");
  assert.ok(migration);

  const prompt = buildMigrationPrompt(migration);
  assert.match(prompt, /<surface_directory>paywalls\/force-update<\/surface_directory>/);
  assert.match(prompt, /<source_paywall id="255456">https:\/\/runtime\.example\/store\/document\/abc/);
  assert.match(prompt, /- Pages: 2/);
  assert.match(prompt, /## Playbook: rebuilding the pages/);
  assert.match(prompt, /# Migrating a dashboard \(editor\) paywall to code/);
  assert.match(prompt, /Never run `superwall push`/);
  assert.match(prompt, /\[STATUS\]/);

  const copy = buildMigrationCopyPrompt(migration);
  assert.doesNotMatch(copy, /\[STATUS\]/);
  assert.match(copy, /- Pages: 2/);
});

test("a missing brief is said out loud in the prompt rather than left blank", () => {
  const dir = scratch("nobrief");
  scaffoldMigration(dir, false);
  const migration = migrationFor(dir, "255456");
  assert.ok(migration);
  assert.equal(migration.brief, "");
  assert.match(buildMigrationPrompt(migration), /MIGRATION\.md is missing/);
});

const PAYWALL = {
  id: 255456,
  name: "Force Update",
  application_id: 42,
  application_platform: "ios",
  paywall_url: "https://runtime.example/store/document/abc",
};

function scaffoldInto(routes: Record<string, Reply>, fetchText?: (url: string) => Promise<string | undefined>) {
  const root = scratch("scaffold");
  const target = path.join(root, "superwall");
  const calls: RendererCall[] = [];
  const { api } = routedApi(routes);
  const run = () =>
    scaffoldFromPaywall(recordingRenderer(calls), api, {
      root,
      target,
      paywallId: "255456",
      newProject: true,
      ...(fetchText === undefined ? {} : { fetchText }),
    });
  return { root, target, calls, run };
}

const said = (calls: RendererCall[], method: string): string[] =>
  calls.filter((call) => call.method === method).map((call) => String(call.value));

test("a paywall whose served document can't be fetched is scaffolded from the API alone", async () => {
  const fetched: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    fetched.push(url);
    return new Response("gone", { status: 404 });
  });
  const { target, calls, run } = scaffoldInto({
    "GET /v2/paywalls/255456": PAYWALL,
    "GET /v2/projects": new Error("projects are down"),
  });

  const origin = await run();

  assert.deepEqual(fetched, [PAYWALL.paywall_url]);
  assert.equal(origin.slug, "force-update");
  assert.deepEqual(said(calls, "spinner.stop"), [
    "Read `Force Update` from the API only — its served document could not be fetched, so inventory it by hand",
  ]);
  assert.ok(fs.existsSync(path.join(target, "paywalls", "force-update", "config.ts")));
  assert.deepEqual(readLock(target).apps, { ios: "42" });
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to app 42, the paywall's app — saved in superwall.lock.",
  ]);
});

test("an unreachable runtime is the same as no document", async () => {
  mock.method(globalThis, "fetch", () => Promise.reject(new TypeError("fetch failed")));
  const { calls, run } = scaffoldInto({ "GET /v2/paywalls/255456": PAYWALL, "GET /v2/projects": [] });

  await run();

  assert.match(said(calls, "spinner.stop")[0] ?? "", /from the API only/);
});

test("a paywall this account can't see, or one that is already code, is refused", async () => {
  const hidden = scaffoldInto({ "GET /v2/paywalls/255456": new ApiError("GET /v2/paywalls/255456", 404, "{}") });
  await assert.rejects(hidden.run(), /^Error: Paywall 255456 isn't visible to this account\. Check the id in the dashboard URL\.$/);
  assert.deepEqual(said(hidden.calls, "spinner.stop"), ["Could not read paywall 255456"]);

  const broken = scaffoldInto({ "GET /v2/paywalls/255456": new ApiError("GET /v2/paywalls/255456", 500, "{}") });
  await assert.rejects(broken.run(), (error: unknown) => error instanceof ApiError && error.status === 500);

  const code = scaffoldInto({
    "GET /v2/paywalls/255456": { ...PAYWALL, headless: true },
  });
  await assert.rejects(code.run(), /is built with the framework already/);
  assert.deepEqual(said(code.calls, "spinner.stop"), ["`Force Update` is already code"]);
});

function scaffoldScreen(source: string): RendererCall[] {
  const root = scratch("screen");
  fs.mkdirSync(path.join(root, "App"));
  fs.writeFileSync(path.join(root, "App", "WelcomeView.swift"), source);
  const calls: RendererCall[] = [];
  scaffoldFromScreen(recordingRenderer(calls), {
    root,
    target: path.join(root, "superwall"),
    file: "App/WelcomeView.swift",
    newProject: true,
  });
  return calls;
}

test("the screen inventory counts actions by use, not by kind, in the singular when there is one", () => {
  const one = scaffoldScreen('import SwiftUI\nstruct WelcomeView: View {\n  var body: some View {\n    Button("Continue") { go() }\n  }\n}\n');
  assert.match(said(one, "step")[0] ?? "", /: 1 string, 0 assets, 0 products, 1 action$/);

  const three = scaffoldScreen(
    'import SwiftUI\nstruct WelcomeView: View {\n  var body: some View {\n    Button("Yes") { a() }\n    Button("No") { b() }\n    Button("Later") { c() }\n  }\n}\n',
  );
  assert.match(said(three, "step")[0] ?? "", /: 3 strings, 0 assets, 0 products, 3 actions$/);
});

const FORCE_UPDATE = fs.readFileSync(path.resolve("tests/fixtures/origin/force-update.html"), "utf8");

test("a paywall is scaffolded from its served document, bound to its app, and never overwritten", async () => {
  const fetched: string[] = [];
  const { target, calls, run } = scaffoldInto(
    {
      "GET /v2/paywalls/255456": { ...PAYWALL, products: [{ reference_name: "primary", identifier: "missing" }] },
      "GET /v2/projects": [{ id: 9, applications: [{ id: 42, name: "Acme", platform: "ios" }] }],
    },
    async (url) => (fetched.push(url), FORCE_UPDATE),
  );

  const origin = await run();

  assert.deepEqual(fetched, [PAYWALL.paywall_url]);
  assert.deepEqual(said(calls, "spinner.stop"), ["Read `Force Update`: 1 products, 1 page"]);
  assert.deepEqual(said(calls, "step"), ["Created superwall/paywalls/force-update from `Force Update`"]);
  assert.deepEqual(said(calls, "warn"), [
    "Some product slots have no store product on the dashboard — fix them in config.ts before pushing.",
  ]);
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to `Acme`, the paywall's app — saved in superwall.lock, so commit that file.",
  ]);
  assert.deepEqual(readLock(target).origins, {
    "paywall/force-update": { paywallId: "255456", url: PAYWALL.paywall_url },
  });
  assert.equal(origin.id, "255456");

  await assert.rejects(run(), /^Error: `paywalls\/force-update` already exists in superwall — rename or remove it first\.$/);
});

test("a paywall with no served document records no origin, and an app already in the lock is left alone", async () => {
  const root = scratch("bare-target");
  const calls: RendererCall[] = [];
  const { api, sent } = routedApi({
    "GET /v2/paywalls/255456": { id: 255456, name: "Force Update", application_id: 42, application_platform: "ios" },
  });
  fs.writeFileSync(path.join(root, "superwall.lock"), JSON.stringify({ version: 1, apps: { ios: "7" } }));

  await scaffoldFromPaywall(recordingRenderer(calls), api, { root, target: root, paywallId: "255456", newProject: false });

  assert.deepEqual(said(calls, "step"), ["Created ./paywalls/force-update from `Force Update`"]);
  assert.equal(readLock(root).origins, undefined);
  assert.deepEqual(readLock(root).apps, { ios: "7" });
  assert.deepEqual(said(calls, "success"), []);
  assert.deepEqual(sent.map((call) => call.path), ["/v2/paywalls/255456"]);
  await assert.rejects(
    scaffoldFromPaywall(recordingRenderer(calls), api, { root, target: root, paywallId: "255456", newProject: false }),
    /already exists in \. —/,
  );
});

test("an app the account lists without a name is named by its id", async () => {
  const { calls, run } = scaffoldInto(
    {
      "GET /v2/paywalls/255456": { ...PAYWALL, name: undefined },
      "GET /v2/projects": [{ id: 9, applications: [{ id: 42, platform: "ios" }] }],
    },
    async () => undefined,
  );

  const origin = await run();

  assert.equal(origin.name, "Paywall 255456");
  assert.deepEqual(said(calls, "success"), [
    "Pushes go to `42`, the paywall's app — saved in superwall.lock, so commit that file.",
  ]);
});

test("by default the served document is fetched from the runtime, and its pages are counted", async () => {
  const fetched: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    fetched.push(url);
    return new Response(fs.readFileSync(path.resolve("tests/fixtures/origin/multi-page-template.html"), "utf8"));
  });
  const { calls, run } = scaffoldInto({ "GET /v2/paywalls/255456": PAYWALL, "GET /v2/projects": [] });

  await run();

  assert.deepEqual(fetched, [PAYWALL.paywall_url]);
  assert.match(said(calls, "spinner.stop")[0] ?? "", /^Read `Force Update`: 0 products, 4 pages$/);
});

test("a paywall that is already code is named by its id when it has no name", async () => {
  const { calls, run } = scaffoldInto({ "GET /v2/paywalls/255456": { id: 255456, headless: true } });

  await assert.rejects(run(), /Paywall 255456 is built with the framework already/);
  assert.deepEqual(said(calls, "spinner.stop"), ["`255456` is already code"]);
});

test("a dashboard migration is named and rerun by its paywall id", () => {
  const dir = scratch("source");
  scaffoldMigration(dir);
  const migration = migrationFor(dir, "255456");
  assert.ok(migration);

  assert.equal(migrationSource(migration), "255456");
  assert.equal(migrationCommand(migration), "superwall migrate 255456");
});
