import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClaudeArgs } from "@/core/agent/drivers/claude";
import { buildCodexArgs } from "@/core/agent/drivers/codex";
import { toolsForCapabilities } from "@/core/agent/drivers/capabilities";
import type { AgentRunOptions } from "@/core/agent/drivers";

function options(capabilities: AgentRunOptions["capabilities"]): AgentRunOptions {
  return { prompt: "do it", cwd: "/tmp/app", capabilities };
}

test("Claude read-only actions use plan mode and exclude editing tools", () => {
  const args = buildClaudeArgs(options({ filesystem: "read", network: true, shell: "read-only" }));
  const tools = args[args.indexOf("--allowedTools") + 1]!;

  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  assert.match(tools, /Read/);
  assert.match(tools, /Bash/);
  assert.match(tools, /WebFetch/);
  assert.doesNotMatch(tools, /Write|Edit/);
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

test("Codex maps filesystem and network capabilities independently", () => {
  const read = buildCodexArgs(
    options({ filesystem: "read", network: true, shell: "read-only" }),
    "/tmp/last",
  );
  const write = buildCodexArgs(
    options({ filesystem: "write", network: false, shell: "unrestricted" }),
    "/tmp/last",
  );

  assert.equal(read[read.indexOf("--sandbox") + 1], "read-only");
  assert.ok(read.includes("sandbox_read_only.network_access=true"));
  assert.equal(write[write.indexOf("--sandbox") + 1], "workspace-write");
  assert.equal(
    write.some((arg) => arg.includes("network_access")),
    false,
  );
});

test("agent tool access is derived from independent capability axes", () => {
  assert.deepEqual(
    toolsForCapabilities({
      filesystem: "read",
      network: false,
      shell: "none",
    }),
    ["Read", "Glob", "Grep"],
  );
  assert.deepEqual(
    toolsForCapabilities({
      filesystem: "write",
      network: true,
      shell: "unrestricted",
    }),
    ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebFetch", "WebSearch"],
  );
});
