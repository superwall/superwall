import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { buildCodexArgs, codexDriver } from "@/core/workflows/agent/drivers/codex";
import type { AgentEvent, AgentRunOptions } from "@/core/workflows/agent/drivers/index";
import { restoreBin, useBin } from "../../../../helpers/bin";

const dirs: string[] = [];

function options(capabilities: AgentRunOptions["capabilities"]): AgentRunOptions {
  return { prompt: "do it", cwd: "/tmp/app", capabilities };
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-codex-"));
  dirs.push(dir);
  return dir;
}

function fakeCodex(
  stdout: string[],
  {
    stderr = [],
    code = 0,
    lastMessage,
    lastMessageIsDirectory = false,
  }: { stderr?: string[]; code?: number; lastMessage?: string; lastMessageIsDirectory?: boolean } = {},
): { argsFile: string; lastMessageFile: string } {
  const dir = tempDir();
  const argsFile = path.join(dir, "args");
  const lastMessageFile = path.join(dir, "last-message-path");
  fs.writeFileSync(path.join(dir, "stdout"), stdout.map((line) => `${line}\n`).join(""));
  fs.writeFileSync(path.join(dir, "stderr"), stderr.map((line) => `${line}\n`).join(""));
  if (lastMessage !== undefined) fs.writeFileSync(path.join(dir, "last"), lastMessage);
  const bin = useBin({
    codex: [
      'if [ "$1" = "--version" ]; then echo "codex-cli 0.50.0"; exit 0; fi',
      `printf '%s\\0' "$@" > "${argsFile}"`,
      'while [ $# -gt 0 ]; do if [ "$1" = "--output-last-message" ]; then out="$2"; fi; shift; done',
      `printf '%s' "$out" > "${lastMessageFile}"`,
      `if [ -f "${dir}/last" ]; then /bin/cat "${dir}/last" > "$out"; fi`,
      lastMessageIsDirectory ? '/bin/mkdir "$out"' : "",
      `/bin/cat "${dir}/stdout"`,
      `/bin/cat "${dir}/stderr" >&2`,
      `exit ${code}`,
    ].join("\n"),
  });
  process.env.PATH = bin;
  return { argsFile, lastMessageFile };
}

function run(extra: Partial<AgentRunOptions> = {}) {
  const events: AgentEvent[] = [];
  const result = codexDriver.run({
    prompt: "integrate",
    cwd: tempDir(),
    capabilities: { filesystem: "write", network: false, shell: "unrestricted" },
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return { result, events };
}

afterEach(() => {
  restoreBin();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("Codex maps filesystem and network capabilities independently", () => {
  const read = buildCodexArgs(
    options({ filesystem: "read", network: true, shell: "read-only" }),
    "/tmp/last",
  );
  const write = buildCodexArgs(
    options({ filesystem: "write", network: false, shell: "unrestricted" }),
    "/tmp/last",
  );
  const writeOnline = buildCodexArgs(
    options({ filesystem: "write", network: true, shell: "unrestricted" }),
    "/tmp/last",
  );

  assert.equal(read[read.indexOf("--sandbox") + 1], "read-only");
  assert.ok(read.includes("sandbox_read_only.network_access=true"));
  assert.equal(write[write.indexOf("--sandbox") + 1], "workspace-write");
  assert.equal(
    write.some((arg) => arg.includes("network_access")),
    false,
  );
  assert.ok(writeOnline.includes("sandbox_workspace_write.network_access=true"));
  assert.equal(write[write.indexOf("--output-last-message") + 1], "/tmp/last");
});

test("Codex has no system prompt, so the commandments lead the prompt", () => {
  const plain = buildCodexArgs(options({ filesystem: "read", network: false, shell: "none" }), "/tmp/last");
  const appended = buildCodexArgs(
    { ...options({ filesystem: "read", network: false, shell: "none" }), systemAppend: "RULES" },
    "/tmp/last",
  );

  assert.equal(plain[1], "do it");
  assert.equal(appended[1], "RULES\n\n---\n\ndo it");
});

test("Codex is detected with its version when it is on PATH", async () => {
  fakeCodex([]);

  assert.deepEqual(await codexDriver.detect(), {
    id: "codex",
    displayName: "Codex",
    bin: "codex",
    version: "codex-cli 0.50.0",
  });
});

test("Codex is not detected when it is not on PATH", async () => {
  process.env.PATH = useBin({});

  assert.equal(await codexDriver.detect(), null);
});

test("a successful run streams messages and commands, and returns the last message", async () => {
  const { argsFile, lastMessageFile } = fakeCodex(
    [
      "not json",
      "42",
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "[STATUS] Adding the package" } }),
      JSON.stringify({ msg: { type: "agent_message", message: "  Package added.  " } }),
      JSON.stringify({ type: "assistant_delta", delta: "   " }),
      JSON.stringify({ type: "item.started", item: { type: "command_execution", command: ["bash", "-lc", "swift build"] } }),
      JSON.stringify({ type: "patch_apply_begin" }),
      JSON.stringify({ type: "turn.completed" }),
      JSON.stringify({ msg: { message: "untyped" } }),
    ],
    { lastMessage: "  Integrated.\n" },
  );
  const cwd = tempDir();

  const { result: pending, events } = run({ cwd });

  assert.deepEqual(await pending, { finalText: "Integrated.", ok: true, failureReason: undefined });
  assert.deepEqual(events, [
    { type: "status", text: "Adding the package" },
    { type: "text", text: "Package added." },
    { type: "tool", name: "exec", summary: "bash -lc swift build" },
    { type: "tool", name: "exec", summary: undefined },
  ]);
  const args = fs.readFileSync(argsFile, "utf8").split("\0");
  assert.deepEqual(args.slice(0, 2), ["exec", "integrate"]);
  assert.equal(args[args.indexOf("-C") + 1], cwd);
  assert.equal(fs.existsSync(fs.readFileSync(lastMessageFile, "utf8")), false);
});

test("a failed run reports the exit code, with no final text when Codex wrote none", async () => {
  fakeCodex([], { code: 3 });

  const { result: pending, events } = run();

  assert.deepEqual(await pending, { finalText: undefined, ok: false, failureReason: undefined });
  assert.deepEqual(events, [{ type: "error", message: "codex exited with code 3" }]);
});

test("an empty last message is no final text", async () => {
  fakeCodex([], { lastMessage: "  \n" });

  assert.deepEqual(await run().result, { finalText: undefined, ok: true, failureReason: undefined });
});

test("events are not parsed without a listener", async () => {
  fakeCodex([JSON.stringify({ msg: { type: "agent_message", message: "hello" } })], { lastMessage: "done" });

  assert.deepEqual(await run({ onEvent: undefined }).result, { finalText: "done", ok: true, failureReason: undefined });
});

test("a usage limit on stderr, stdout or in the last message marks the failure", async () => {
  fakeCodex([], { stderr: ["You've hit your usage limit."], code: 1 });
  assert.equal((await run().result).failureReason, "usage-limit");
  restoreBin();

  fakeCodex(["Your session limit resets at 5pm"], { code: 1 });
  assert.equal((await run().result).failureReason, "usage-limit");
  restoreBin();

  fakeCodex([], { code: 1, lastMessage: "Your credits are exhausted" });
  assert.deepEqual(await run().result, {
    finalText: "Your credits are exhausted",
    ok: false,
    failureReason: "usage-limit",
  });
  restoreBin();

  fakeCodex([], { lastMessage: "You've hit your usage limit." });
  assert.equal((await run().result).failureReason, undefined);
});

test("a last-message path Codex left as a directory is no final text and never fails the run", async () => {
  const { lastMessageFile } = fakeCodex([], { lastMessageIsDirectory: true });

  const outcome = await run().result;
  const leftover = fs.readFileSync(lastMessageFile, "utf8");
  fs.rmSync(leftover, { recursive: true, force: true });

  assert.deepEqual(outcome, { finalText: undefined, ok: true, failureReason: undefined });
});
