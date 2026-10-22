import { test } from "node:test";
import assert from "node:assert/strict";
import { actionById } from "@/core/workflows/agent/actions";
import { buildActionPrompt, readCommandments } from "@/core/workflows/agent/prompt";
import { runAction, runWithDriverFallback } from "@/core/workflows/agent/run";
import type { AgentDriver, AgentEvent, AgentResult, AgentRunOptions } from "@/core/workflows/agent/drivers/index";
import { frameworkByIntegration } from "@/core/codebase/frameworks";
import { Integration } from "@/environment";

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

test("when every driver hits its usage limit, the last limit is the result", async () => {
  const calls: string[] = [];
  const last = { ok: false, finalText: "codex limit", failureReason: "usage-limit" } satisfies AgentResult;
  const result = await runWithDriverFallback(
    [fakeDriver("claude", { ok: false, failureReason: "usage-limit" }, calls), fakeDriver("codex", last, calls)],
    options,
  );

  assert.deepEqual(calls, ["claude", "codex"]);
  assert.equal(result, last);
});

test("running without any driver is an error", async () => {
  await assert.rejects(runWithDriverFallback([], options), /No agent driver available\./);
});

test("an action runs in the app directory with its prompt, the commandments and its capabilities", async () => {
  const seen: AgentRunOptions[] = [];
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  const driver: AgentDriver = {
    id: "claude",
    displayName: "Claude Code",
    detect: async () => null,
    run: async (runOptions) => {
      seen.push(runOptions);
      runOptions.onEvent?.({ type: "status", text: "Reviewing" });
      return { ok: true, finalText: "report" };
    },
  };
  const ctx = {
    app: {
      path: "/tmp/the-app",
      relPath: ".",
      name: "app",
      framework: frameworkByIntegration[Integration.swift],
      integration: Integration.swift,
      score: 1,
    },
    apiKey: "pk_x",
    existing: { sdkInstalled: true, configureFound: true, fullyIntegrated: true },
  };

  const result = await runAction({
    driver,
    action: actionById.review,
    ctx,
    onEvent: (event) => events.push(event),
    signal: controller.signal,
  });

  assert.deepEqual(result, { ok: true, finalText: "report" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.cwd, "/tmp/the-app");
  assert.equal(seen[0]?.prompt, buildActionPrompt(actionById.review, ctx));
  assert.equal(seen[0]?.systemAppend, readCommandments());
  assert.equal(seen[0]?.capabilities, actionById.review.capabilities);
  assert.equal(seen[0]?.signal, controller.signal);
  assert.deepEqual(events, [{ type: "status", text: "Reviewing" }]);
});

test("an action falls back to the given drivers after a usage limit", async () => {
  const calls: string[] = [];
  const result = await runAction({
    driver: fakeDriver("claude", { ok: false, failureReason: "usage-limit" }, calls),
    fallbackDrivers: [fakeDriver("superwall", { ok: true }, calls)],
    action: actionById.integrate,
    ctx: {
      app: {
        path: "/tmp/app",
        relPath: ".",
        name: "app",
        framework: frameworkByIntegration[Integration.flutter],
        integration: Integration.flutter,
        score: 1,
      },
      apiKey: "",
      existing: { sdkInstalled: false, configureFound: false, fullyIntegrated: false },
    },
  });

  assert.deepEqual(calls, ["claude", "superwall"]);
  assert.deepEqual(result, { ok: true });
});
