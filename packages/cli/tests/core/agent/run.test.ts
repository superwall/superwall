import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithDriverFallback } from "@/core/agent/run";
import type { AgentDriver, AgentResult } from "@/core/agent/drivers";
import { isUsageLimitText } from "@/core/agent/drivers/limits";

function fakeDriver(id: AgentDriver["id"], result: AgentResult, calls: string[]): AgentDriver {
  return {
    id,
    displayName: id,
    detect: async () => null,
    run: async () => {
      calls.push(id);
      return result;
    },
  };
}

const options = {
  prompt: "test",
  cwd: "/tmp",
  capabilities: {
    filesystem: "read",
    network: false,
    shell: "read-only",
  } as const,
};

test("falls back to the next driver after a usage limit", async () => {
  const calls: string[] = [];
  const result = await runWithDriverFallback(
    [
      fakeDriver("claude", { ok: false, failureReason: "usage-limit" }, calls),
      fakeDriver("codex", { ok: true, finalText: "done" }, calls),
    ],
    options,
  );

  assert.deepEqual(calls, ["claude", "codex"]);
  assert.deepEqual(result, { ok: true, finalText: "done" });
});

test("does not fall back after an unrelated driver failure", async () => {
  const calls: string[] = [];
  const failure = {
    ok: false,
    finalText: "build failed",
  } satisfies AgentResult;
  const result = await runWithDriverFallback(
    [fakeDriver("claude", failure, calls), fakeDriver("codex", { ok: true }, calls)],
    options,
  );

  assert.deepEqual(calls, ["claude"]);
  assert.equal(result, failure);
});

test("recognizes provider session and hosted credit limits", () => {
  assert.equal(isUsageLimitText("You've hit your session limit · resets 5pm"), true);
  assert.equal(isUsageLimitText("You've hit your usage limit. Try again tomorrow."), true);
  assert.equal(isUsageLimitText("Your hosted Superwall Agent credit is exhausted."), true);
  assert.equal(isUsageLimitText("The migration failed to compile."), false);
});
