import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { AgentDriver, AgentRunOptions, AgentResult } from "@/core/agent/drivers";
import {
  migrationFor,
  offerMigration,
  runMigration,
  type MigrationRuntime,
  type PaywallMigration,
} from "@/core/paywalls/migration";
import { writeOrigin } from "@/core/paywalls/project/lock";
import type { Renderer } from "@/ui";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const migration = (): PaywallMigration => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-offer-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "paywalls", "force-update"), { recursive: true });
  fs.writeFileSync(path.join(dir, "paywalls", "force-update", "MIGRATION.md"), "# brief\n");
  writeOrigin(dir, "paywall", "force-update", { paywallId: "255456", url: "https://runtime.example/doc" });
  const found = migrationFor(dir, "255456");
  assert.ok(found);
  return found;
};

const driver = (result: AgentResult, seen: AgentRunOptions[] = []): AgentDriver => ({
  id: "claude",
  displayName: "Claude Code",
  detect: async () => ({ id: "claude", displayName: "Claude Code", bin: "claude" }),
  run: async (options) => {
    seen.push(options);
    if (options.onEvent) options.onEvent({ type: "status", text: "Rebuilding index" });
    return result;
  },
});

const runtimeWith = (
  drivers: AgentDriver[],
  overrides: Partial<MigrationRuntime> = {},
): MigrationRuntime => ({
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

test("runMigration hands the agent the prompt in the project directory with write access", async () => {
  const seen: AgentRunOptions[] = [];
  const target = migration();
  const result = await runMigration(target, undefined, runtimeWith([driver({ ok: true }, seen)]));
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.cwd, target.superwallDir);
  assert.deepEqual(seen[0]?.capabilities, { filesystem: "write", network: true, shell: "unrestricted" });
  assert.match(seen[0]?.prompt ?? "", /paywalls\/force-update\/MIGRATION\.md/);
  assert.match(seen[0]?.prompt ?? "", /\[STATUS\]/);
});

test("runMigration refuses when no agent is installed", async () => {
  await assert.rejects(
    runMigration(migration(), undefined, runtimeWith([])),
    /No coding agent found/,
  );
});

test("the offer runs the agent, streams its status, and reports its closing note", async () => {
  const calls: RendererCall[] = [];
  const choice = await offerMigration(
    choosing(calls, "agent"),
    true,
    migration(),
    undefined,
    runtimeWith([driver({ ok: true, finalText: "Not carried over: surveys\n[STATUS] Done" })]),
  );
  assert.equal(choice, "agent");
  const select = calls.find((call) => call.method === "select")?.value as {
    options: Array<{ value: string; label: string }>;
    initialValue: string;
  };
  assert.deepEqual(
    select.options.map((option) => option.value),
    ["agent", "copy", "later"],
  );
  assert.match(select.options[0]?.label ?? "", /With Claude Code/);
  assert.equal(select.initialValue, "agent");
  assert.match(String(calls.find((call) => call.method === "spinner.message")?.value), /Rebuilding index/);
  assert.match(String(calls.find((call) => call.method === "spinner.stop")?.value), /Rebuilt paywalls\/force-update/);
  const report = calls.find((call) => call.method === "report");
  assert.match(String(report?.value), /Not carried over: surveys/);
});

test("a run that stops early is an error, with what the agent said", async () => {
  const calls: RendererCall[] = [];
  await assert.rejects(
    offerMigration(
      recordingRenderer(calls),
      true,
      migration(),
      "agent",
      runtimeWith([driver({ ok: false, finalText: "Blocked before editing" })]),
    ),
    /did not complete/,
  );
  assert.match(String(calls.find((call) => call.method === "report")?.value), /Blocked before editing/);
});

test("without an agent installed the offer defaults to copying, and copying lands on the clipboard", async () => {
  const calls: RendererCall[] = [];
  const choice = await offerMigration(choosing(calls, "copy"), true, migration(), undefined, runtimeWith([]));
  assert.equal(choice, "copy");
  const select = calls.find((call) => call.method === "select")?.value as {
    options: Array<{ value: string }>;
    initialValue: string;
  };
  assert.deepEqual(
    select.options.map((option) => option.value),
    ["copy", "later"],
  );
  assert.equal(select.initialValue, "copy");
  const note = calls.find((call) => call.method === "note")?.value as { title?: string; value: string };
  assert.match(String(note.title), /copied to clipboard/);
});

test("when the clipboard is unavailable the prompt is printed to copy by hand, without the status protocol", async () => {
  const calls: RendererCall[] = [];
  await offerMigration(
    recordingRenderer(calls),
    true,
    migration(),
    "copy",
    runtimeWith([], { copyToClipboard: async () => false }),
  );
  const note = calls.find((call) => call.method === "note")?.value as { title?: string; value: string };
  assert.match(String(note.title), /copy it manually/);
  assert.match(note.value, /MIGRATION\.md/);
  assert.doesNotMatch(note.value, /\[STATUS\]/);
});

test("cancelling the prompt, or running without a terminal, does nothing", async () => {
  const cancelled: RendererCall[] = [];
  assert.equal(await offerMigration(choosing(cancelled, null), true, migration(), undefined, runtimeWith([])), "later");
  assert.equal(
    cancelled.filter((call) => call.method === "note" || call.method === "spinner.start").length,
    0,
  );

  const headless: RendererCall[] = [];
  assert.equal(await offerMigration(recordingRenderer(headless), false, migration(), undefined, runtimeWith([])), "later");
  assert.equal(headless.length, 0);
});
