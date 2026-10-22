import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { defineCommand, type CommandContext, type RawInput } from "@/program/command";
import { recordingRenderer } from "../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

const quiet = { renderer: () => recordingRenderer(), waitForPaint: false };


const probe = (spec: { auth?: "none" | "optional" | "required"; json?: boolean; prompts?: boolean } = {}) => {
  const seen: { ctx?: CommandContext; input?: unknown } = {};
  const command = defineCommand({
    name: "probe",
    summary: "A probe",
    args: {
      id: { describe: "An id", required: true },
      rest: { describe: "The rest", variadic: true },
    },
    flags: {
      count: { type: "number", describe: "A count" },
      level: { type: "string", choices: ["low", "high"], default: "low", describe: "A level" },
      tag: { type: "list", describe: "Tags" },
      force: { type: "boolean", describe: "Force" },
      app: { type: "string", describe: "The app" },
      dryRun: { type: "boolean", describe: "Plan only" },
    },
    examples: [["probe 1", "Probe one"]],
    auth: spec.auth ?? "none",
    json: spec.json ?? true,
    prompts: spec.prompts ?? true,
    mcp: "read",
    run: (ctx, input) => {
      seen.ctx = ctx;
      seen.input = input;
    },
  });
  return { command, seen };
};

test("a command reads its arguments and flags by their declared types and defaults", async () => {
  const { command, seen } = probe();
  const input: RawInput = {
    args: { id: " 42 ", rest: ["a", "b"] },
    flags: { count: "7", tag: "one", force: true, app: "5861", dryRun: true },
  };
  await command.execute(input, { ...quiet, nonInteractive: true });
  assert.deepEqual(seen.input, {
    args: { id: "42", rest: ["a", "b"] },
    flags: { count: 7, level: "low", tag: ["one"], force: true, app: "5861", dryRun: true },
  });
  assert.equal(seen.ctx?.target.app, "5861");
  assert.equal(seen.ctx?.dryRun, true);
});

test("a missing required argument or a bad value never reaches run", async () => {
  const { command, seen } = probe();
  for (const input of [{ args: {} }, { args: { id: "1" }, flags: { level: "max" } }, { args: { id: "1" }, flags: { count: "x" } }]) {
    assert.throws(() => command.validate(input), /Missing <id>|--level takes one of: low, high|--count takes a number/);
  }
  assert.equal(seen.input, undefined);
});
