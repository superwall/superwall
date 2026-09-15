import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { AgentDriver, AgentRunOptions, AgentResult } from "@/core/agent/drivers";
import {
  buildMigrationCopyPrompt,
  buildMigrationPrompt,
  hasOriginal,
  migrationCommand,
  migrationFor,
  migrationSource,
  migrationsOf,
  offerMigration,
  runMigration,
  scaffoldFromScreen,
  screenMigrationFor,
  type MigrationRuntime,
} from "@/core/paywalls/migration";
import { readLock, writeOrigin } from "@/core/paywalls/project/lock";
import type { Renderer } from "@/ui";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const FIXTURES = path.resolve("tests/fixtures/screens");
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const scratch = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-screen-mig-"));
  dirs.push(dir);
  return dir;
};

const appWithScreen = (): { root: string; file: string } => {
  const root = scratch();
  fs.mkdirSync(path.join(root, "App"), { recursive: true });
  const file = path.join(root, "App", "UpdateRequiredView.swift");
  fs.copyFileSync(path.join(FIXTURES, "UpdateRequiredView.swift"), file);
  return { root, file };
};

test("scaffolding from a screen writes the surface, the brief, the lock origin, and reports the inventory", () => {
  const { root, file } = appWithScreen();
  const calls: RendererCall[] = [];
  const target = path.join(root, "superwall");
  const screen = scaffoldFromScreen(recordingRenderer(calls), {
    root,
    target,
    file: "App/UpdateRequiredView.swift",
    newProject: true,
  });
  assert.equal(screen.slug, "update-required");
  assert.equal(screen.path, "../App/UpdateRequiredView.swift");
  assert.ok(fs.existsSync(path.join(target, "package.json")));
  assert.match(fs.readFileSync(path.join(target, "paywalls", "update-required", "config.ts"), "utf8"), /annual: "com.acme.pro.annual"/);
  const brief = fs.readFileSync(path.join(target, "paywalls", "update-required", "MIGRATION.md"), "utf8");
  assert.match(brief, /File: `\.\.\/App\/UpdateRequiredView.swift` \(SwiftUI\)/);
  assert.match(brief, /Screenshot of the original: none/);
  assert.deepEqual(readLock(target).origins, {
    "paywall/update-required": { path: "../App/UpdateRequiredView.swift", framework: "swiftui" },
  });
  const steps = calls.filter((call) => call.method === "step").map((call) => String(call.value));
  assert.match(steps[0] ?? "", /Read `\.\.\/App\/UpdateRequiredView.swift` \(SwiftUI\): 6 strings, 2 assets, 1 product, 7 actions/);
  assert.match(steps[1] ?? "", /Created superwall\/paywalls\/update-required for `Update Required`/);
  assert.match(String(calls.find((call) => call.method === "warn")?.value), /Product identifiers were lifted/);

  const found = screenMigrationFor(target, file);
  assert.ok(found);
  assert.equal(found.surfaceId, "update-required");
  assert.equal(migrationFor(target, "1"), undefined);
  assert.equal(screenMigrationFor(target, path.join(root, "App", "Other.swift")), undefined);
  assert.equal(migrationSource(found, root), path.join("App", "UpdateRequiredView.swift"));
  assert.equal(migrationCommand(found, root), "superwall migrate --screen App/UpdateRequiredView.swift");
  assert.equal(hasOriginal(found), false);
});

test("a screenshot is copied in as the original and recorded in the lock", () => {
  const { root } = appWithScreen();
  const shot = path.join(root, "shot.png");
  fs.writeFileSync(shot, "png");
  const calls: RendererCall[] = [];
  scaffoldFromScreen(recordingRenderer(calls), {
    root,
    target: root,
    file: "App/UpdateRequiredView.swift",
    newProject: false,
    screenshot: shot,
  });
  assert.equal(fs.readFileSync(path.join(root, "paywalls", "update-required", "original.png"), "utf8"), "png");
  assert.equal(fs.existsSync(path.join(root, "package.json")), false);
  const origin = readLock(root).origins?.["paywall/update-required"];
  assert.deepEqual(origin, { path: "App/UpdateRequiredView.swift", framework: "swiftui", screenshot: "original.png" });
  assert.match(fs.readFileSync(path.join(root, "paywalls", "update-required", "MIGRATION.md"), "utf8"), /`original.png` \(Compare › Original/);
  const found = screenMigrationFor(root, path.join(root, "App", "UpdateRequiredView.swift"));
  assert.ok(found);
  assert.equal(hasOriginal(found), true);
  assert.equal(migrationSource(found, root), path.join("App", "UpdateRequiredView.swift"));
  assert.equal(calls.some((call) => call.method === "warn"), true);
});

test("a surface that already exists is never overwritten", () => {
  const { root } = appWithScreen();
  fs.mkdirSync(path.join(root, "paywalls", "update-required"), { recursive: true });
  fs.writeFileSync(path.join(root, "paywalls", "update-required", "config.ts"), "mine");
  assert.throws(
    () =>
      scaffoldFromScreen(recordingRenderer(), {
        root,
        target: root,
        file: "App/UpdateRequiredView.swift",
        newProject: false,
      }),
    /`paywalls\/update-required` already exists in \./,
  );
  assert.equal(fs.readFileSync(path.join(root, "paywalls", "update-required", "config.ts"), "utf8"), "mine");
});

test("a screen without products scaffolds quietly", () => {
  const root = scratch();
  fs.copyFileSync(path.join(FIXTURES, "LegacyUpdateViewController.swift"), path.join(root, "Legacy.swift"));
  const calls: RendererCall[] = [];
  scaffoldFromScreen(recordingRenderer(calls), { root, target: root, file: "Legacy.swift", newProject: false });
  assert.equal(calls.some((call) => call.method === "warn"), false);
  assert.match(String(calls.find((call) => call.method === "step")?.value), /0 products, 2 actions/);
});

test("the screen prompt carries the source path, the framework reference, and the brief", () => {
  const { root, file } = appWithScreen();
  const target = path.join(root, "superwall");
  scaffoldFromScreen(recordingRenderer(), { root, target, file, newProject: true });
  const migration = screenMigrationFor(target, file);
  assert.ok(migration);
  const prompt = buildMigrationPrompt(migration);
  assert.match(prompt, /<source_screen framework="SwiftUI">\.\.\/App\/UpdateRequiredView.swift<\/source_screen>/);
  assert.match(prompt, /<original_screenshot>none<\/original_screenshot>/);
  assert.match(prompt, /## Playbook: rebuilding the screen/);
  assert.match(prompt, /# iOS source screens \(SwiftUI and UIKit\)/);
  assert.doesNotMatch(prompt, /React Native and Expo source screens/);
  assert.match(prompt, /# Migrating "Update Required" to Superwall/);
  assert.match(prompt, /\[STATUS\]/);
  assert.doesNotMatch(buildMigrationCopyPrompt(migration), /\[STATUS\]/);
});

test("each framework gets its own reference, and a screenshot is named when captured", () => {
  const root = scratch();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, "UpdateRequiredScreen.tsx"), path.join(root, "src", "UpdateRequiredScreen.tsx"));
  fs.copyFileSync(path.join(FIXTURES, "update_required_screen.dart"), path.join(root, "src", "update_required_screen.dart"));
  fs.copyFileSync(path.join(FIXTURES, "LegacyUpdateViewController.swift"), path.join(root, "src", "LegacyUpdateViewController.swift"));
  fs.writeFileSync(path.join(root, "shot.png"), "png");
  scaffoldFromScreen(recordingRenderer(), { root, target: root, file: "src/UpdateRequiredScreen.tsx", newProject: false, screenshot: path.join(root, "shot.png") });
  const rn = screenMigrationFor(root, path.join(root, "src", "UpdateRequiredScreen.tsx"));
  assert.ok(rn);
  assert.match(buildMigrationPrompt(rn), /React Native and Expo source screens/);
  assert.match(buildMigrationPrompt(rn), /<original_screenshot>paywalls\/update-required\/original.png<\/original_screenshot>/);

  assert.throws(
    () => scaffoldFromScreen(recordingRenderer(), { root, target: root, file: "src/update_required_screen.dart", newProject: false }),
    /`paywalls\/update-required` already exists/,
  );
});

test("a Flutter and a UIKit screen pick their references", () => {
  const root = scratch();
  fs.copyFileSync(path.join(FIXTURES, "update_required_screen.dart"), path.join(root, "a.dart"));
  fs.copyFileSync(path.join(FIXTURES, "LegacyUpdateViewController.swift"), path.join(root, "LegacyUpdateViewController.swift"));
  scaffoldFromScreen(recordingRenderer(), { root, target: root, file: "a.dart", newProject: false });
  scaffoldFromScreen(recordingRenderer(), { root, target: root, file: "LegacyUpdateViewController.swift", newProject: false });
  const flutter = screenMigrationFor(root, path.join(root, "a.dart"));
  const uikit = screenMigrationFor(root, path.join(root, "LegacyUpdateViewController.swift"));
  assert.ok(flutter && uikit);
  assert.match(buildMigrationPrompt(flutter), /# Flutter source screens/);
  assert.match(buildMigrationPrompt(uikit), /# iOS source screens/);
  assert.equal(migrationsOf(root).length, 2);
});

test("a screen origin whose brief is gone still builds a prompt that says so", () => {
  const root = scratch();
  writeOrigin(root, "paywall", "gone", { path: "../App/Gone.swift", framework: "swiftui" });
  const migration = migrationsOf(root)[0];
  assert.ok(migration);
  assert.match(buildMigrationPrompt(migration), /MIGRATION.md is missing — inventory the source file first/);
});

const driver = (result: AgentResult, seen: AgentRunOptions[] = []): AgentDriver => ({
  id: "claude",
  displayName: "Claude Code",
  detect: async () => ({ id: "claude", displayName: "Claude Code", bin: "claude" }),
  run: async (options) => {
    seen.push(options);
    return result;
  },
});

const runtimeWith = (drivers: AgentDriver[], overrides: Partial<MigrationRuntime> = {}): MigrationRuntime => ({
  detectDrivers: async () =>
    drivers.map((candidate) => ({
      driver: candidate,
      info: { id: candidate.id, displayName: "Claude Code", bin: "claude" },
    })),
  run: async (candidates, options) => {
    const first = candidates[0];
    if (!first) throw new Error("no driver");
    return first.run(options);
  },
  copyToClipboard: async () => true,
  ...overrides,
});

const choosing = (calls: RendererCall[], answer: string | null): Renderer => ({
  ...recordingRenderer(calls),
  select: async (options) => {
    calls.push({ method: "select", value: options });
    return answer;
  },
});

test("the offer names the screen command for later and tells a copier where to paste", async () => {
  const { root, file } = appWithScreen();
  const target = path.join(root, "superwall");
  scaffoldFromScreen(recordingRenderer(), { root, target, file, newProject: true });
  const migration = screenMigrationFor(target, file);
  assert.ok(migration);

  const calls: RendererCall[] = [];
  const choice = await offerMigration(choosing(calls, "copy"), true, migration, undefined, runtimeWith([driver({ ok: true })]));
  assert.equal(choice, "copy");
  const select = calls.find((call) => call.method === "select")?.value as { options: Array<{ hint?: string }> };
  assert.match(select.options[2]?.hint ?? "", /^superwall migrate --screen .*UpdateRequiredView.swift picks this up later/);
  const note = calls.find((call) => call.method === "note")?.value as { value: string };
  assert.match(note.value, /opened in the app's root so it can read the source screen/);

  const seen: AgentRunOptions[] = [];
  await runMigration(migration, undefined, runtimeWith([driver({ ok: true }, seen)]));
  assert.equal(seen[0]?.cwd, target);
  assert.match(seen[0]?.prompt ?? "", /source_screen/);
});
