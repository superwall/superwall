import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { buildClaudeArgs, claudeDriver } from "@/core/workflows/agent/drivers/claude";
import type { AgentEvent, AgentRunOptions } from "@/core/workflows/agent/drivers/index";
import { restoreBin, useBin } from "../../../../helpers/bin";

const dirs: string[] = [];

function options(capabilities: AgentRunOptions["capabilities"]): AgentRunOptions {
  return { prompt: "do it", cwd: "/tmp/app", capabilities };
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-claude-"));
  dirs.push(dir);
  return dir;
}

function fakeClaude(stdout: string[], { stderr = [], code = 0 }: { stderr?: string[]; code?: number } = {}): string {
  const dir = tempDir();
  const argsFile = path.join(dir, "args");
  fs.writeFileSync(path.join(dir, "stdout"), stdout.map((line) => `${line}\n`).join(""));
  fs.writeFileSync(path.join(dir, "stderr"), stderr.map((line) => `${line}\n`).join(""));
  const bin = useBin({
    claude: [
      'if [ "$1" = "--version" ]; then echo "2.1.0 (Claude Code)"; exit 0; fi',
      `printf '%s\\0' "$@" > "${argsFile}"`,
      `/bin/cat "${dir}/stdout"`,
      `/bin/cat "${dir}/stderr" >&2`,
      `exit ${code}`,
    ].join("\n"),
  });
  process.env.PATH = bin;
  return argsFile;
}

function run(extra: Partial<AgentRunOptions> = {}) {
  const events: AgentEvent[] = [];
  const result = claudeDriver.run({
    prompt: "integrate",
    cwd: tempDir(),
    capabilities: { filesystem: "write", network: true, shell: "unrestricted" },
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return { result, events };
}

const assistant = (content: unknown[]) => JSON.stringify({ type: "assistant", message: { content } });
const result = (fields: Record<string, unknown>) => JSON.stringify({ type: "result", ...fields });

afterEach(() => {
  restoreBin();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("Claude read-only actions use plan mode and exclude editing tools", () => {
  const args = buildClaudeArgs(options({ filesystem: "read", network: true, shell: "read-only" }));
  const tools = args[args.indexOf("--allowedTools") + 1]!;

  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  assert.match(tools, /Read/);
  assert.match(tools, /Bash/);
  assert.match(tools, /WebFetch/);
  assert.doesNotMatch(tools, /Write|Edit/);
  assert.equal(args.includes("--append-system-prompt"), false);
});

test("Claude writable actions explicitly enable editing", () => {
  const args = buildClaudeArgs(
    options({ filesystem: "write", network: false, shell: "unrestricted" }),
  );
  const tools = args[args.indexOf("--allowedTools") + 1]!;

  assert.equal(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
  assert.match(tools, /Write/);
  assert.doesNotMatch(tools, /WebFetch/);
});

test("Claude appends the commandments to its system prompt", () => {
  const args = buildClaudeArgs({ ...options({ filesystem: "read", network: false, shell: "none" }), systemAppend: "RULES" });

  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "RULES");
});

test("Claude is detected with its version when it is on PATH", async () => {
  fakeClaude([]);

  assert.deepEqual(await claudeDriver.detect(), {
    id: "claude",
    displayName: "Claude Code",
    bin: "claude",
    version: "2.1.0 (Claude Code)",
  });
});

test("Claude is not detected when it is not on PATH", async () => {
  process.env.PATH = useBin({});

  assert.equal(await claudeDriver.detect(), null);
});

test("a successful run streams statuses and tools, and returns the final text", async () => {
  const argsFile = fakeClaude([
    "not json",
    assistant([
      { type: "text", text: "[STATUS] Installing the SDK" },
      { type: "tool_use", name: "Bash", input: { command: "pod install" } },
    ]),
    JSON.stringify({ type: "system", subtype: "init" }),
    result({ subtype: "success", is_error: false, result: "All set." }),
  ]);
  const cwd = tempDir();

  const { result: pending, events } = run({ cwd, systemAppend: "RULES" });

  assert.deepEqual(await pending, { finalText: "All set.", ok: true, failureReason: undefined });
  assert.deepEqual(events, [
    { type: "status", text: "Installing the SDK" },
    { type: "tool", name: "Bash", summary: "Bash: pod install" },
  ]);
  const args = fs.readFileSync(argsFile, "utf8").split("\0");
  assert.deepEqual(args.slice(0, 2), ["-p", "integrate"]);
  assert.equal(args[args.indexOf("--add-dir") + 1], cwd);
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "RULES");
});

test("an error result is a failure even when the process exits cleanly", async () => {
  fakeClaude([result({ subtype: "success", is_error: true, result: "Something broke" })]);

  const { result: pending, events } = run();

  assert.deepEqual(await pending, { finalText: "Something broke", ok: false, failureReason: undefined });
  assert.deepEqual(events, []);
});

test("a crash without a result reports the exit code", async () => {
  fakeClaude([result({ subtype: "error_during_execution", result: 5 })], { code: 2 });

  const { result: pending, events } = run();

  assert.deepEqual(await pending, { finalText: undefined, ok: false, failureReason: undefined });
  assert.deepEqual(events, [{ type: "error", message: "claude exited with code 2" }]);
});

test("a nonzero exit after a successful result is still a success", async () => {
  fakeClaude([result({ subtype: "success", result: "done" })], { code: 1 });

  const { result: pending, events } = run();

  assert.deepEqual(await pending, { finalText: "done", ok: true, failureReason: undefined });
  assert.deepEqual(events, []);
});

test("a usage limit on stderr, stdout or in the final text marks the failure", async () => {
  fakeClaude([], { stderr: ["You've hit your session limit · resets 5pm"], code: 1 });
  assert.equal((await run().result).failureReason, "usage-limit");
  restoreBin();

  fakeClaude(["Claude usage limit reached"], { code: 1 });
  assert.equal((await run().result).failureReason, "usage-limit");
  restoreBin();

  fakeClaude([result({ subtype: "error_during_execution", result: "Your weekly limit reached" })]);
  assert.deepEqual(await run().result, { finalText: "Your weekly limit reached", ok: false, failureReason: "usage-limit" });
});
