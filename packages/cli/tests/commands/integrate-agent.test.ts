import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "@/command";
import { finish } from "@/commands/integrate/agent";
import { actionById } from "@/core/agent/actions";
import { createCommandOutput } from "@/output";
import { recordingRenderer, type RendererCall } from "../helpers/renderer";

function callsAfterFinish(action: keyof typeof actionById): RendererCall[] {
  const calls: RendererCall[] = [];
  const output = createCommandOutput("rich", recordingRenderer(calls));
  finish({ output } as CommandContext, actionById[action]);
  return calls;
}

test("review workflows end without a generic dashboard outro", () => {
  assert.deepEqual(callsAfterFinish("review"), []);
  assert.deepEqual(callsAfterFinish("review-fix"), []);
});

test("workflows with a useful dashboard handoff keep their final guidance", () => {
  const calls = callsAfterFinish("integrate");

  assert.deepEqual(
    calls.map((call) => call.method),
    ["note", "outro"],
  );
});
