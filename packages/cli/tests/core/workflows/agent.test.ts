import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { copyIntegrationPrompt, finish, printPlan, runActionWithUI } from "@/core/workflows/agent";
import { actionById, type ActionContext } from "@/core/workflows/agent/actions";
import type { AgentDriver, AgentResult, AgentRunOptions } from "@/core/workflows/agent/drivers/index";
import { scanProject } from "@/core/codebase/scan";
import { createCommandOutput } from "@/program/output";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { answeringRenderer, said } from "../../helpers/answers";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { expoApp, restoreSandboxPath, useSandboxPath } from "../../helpers/workflow";

afterEach(() => {
  restoreSandboxPath();
  selectRenderer({ mode: "text" });
});

function callsAfterFinish(action: keyof typeof actionById): RendererCall[] {
  const calls: RendererCall[] = [];
  const output = createCommandOutput("rich", recordingRenderer(calls));
  finish(output, actionById[action]);
  return calls;
}

function recording(): RendererCall[] {
  const calls: RendererCall[] = [];
  useRenderer(answeringRenderer({}, calls));
  return calls;
}

async function context(extra: Partial<ActionContext> = {}): Promise<ActionContext> {
  const app = (await scanProject(expoApp())).apps[0];
  assert.ok(app);
  return {
    app,
    apiKey: "pk_live_abcdef",
    existing: { sdkInstalled: false, configureFound: false, fullyIntegrated: false },
    ...extra,
  };
}

function driver(result: AgentResult, seen: AgentRunOptions[] = []): AgentDriver {
  return {
    id: "claude",
    displayName: "Claude Code",
    detect: async () => null,
    run: async (options) => {
      seen.push(options);
      options.onEvent?.({ type: "status", text: "Adding the SDK" });
      options.onEvent?.({ type: "tool", name: "Edit" });
      return result;
    },
  };
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
  assert.deepEqual(callsAfterFinish("dashboard-setup").map((call) => call.method), ["note", "outro"]);
  assert.deepEqual(callsAfterFinish("migrate").map((call) => call.method), ["outro"]);
});

test("the integration prompt goes to the clipboard, without the runner's status protocol", async () => {
  const { clipboard } = useSandboxPath();
  const calls = recording();
  await copyIntegrationPrompt(await context());
  const copied = fs.readFileSync(clipboard, "utf8");
  assert.match(copied, /pk_live_abcdef/);
  assert.doesNotMatch(copied, /\[STATUS\]/);
  assert.deepEqual(calls.map((call) => call.value), [
    { value: "Paste it into Claude Code, Codex, Cursor, or another coding agent.", title: "Integration prompt copied to clipboard" },
  ]);
});

test("with no clipboard the integration prompt is printed to copy by hand", async () => {
  useSandboxPath({ pbcopy: "exit 1", xclip: "exit 1" });
  const calls = recording();
  await copyIntegrationPrompt(await context());
  const note = calls[0]?.value as { value: string; title: string };
  assert.equal(note.title, "Integration prompt (copy it manually)");
  assert.match(note.value, /pk_live_abcdef/);
});

test("an agent's status lines drive the spinner, and a report action keeps and shows its report", async () => {
  const calls = recording();
  const seen: AgentRunOptions[] = [];
  const ctx = await context();
  await runActionWithUI(driver({ ok: true, finalText: "[STATUS] wrapping up\n\n## Findings\nAll good.\n" }, seen), [], actionById.review, ctx);
  assert.equal(seen[0]?.cwd, ctx.app.path);
  assert.deepEqual(seen[0]?.capabilities, actionById.review.capabilities);
  assert.deepEqual(said(calls, "spinner.start"), ["Reviewing your Superwall setup"]);
  assert.deepEqual(said(calls, "spinner.message"), ["Adding the SDK"]);
  assert.deepEqual(said(calls, "spinner.stop"), ["Setup review complete"]);
  assert.deepEqual(said(calls, "report"), ["## Findings\nAll good."]);
  assert.equal(fs.readFileSync(path.join(ctx.app.path, ".superwall", "review.md"), "utf8"), "## Findings\nAll good.");
});

test("a silent action shows no report, nor does a report action that wrote nothing", async () => {
  const calls = recording();
  const ctx = await context();
  await runActionWithUI(driver({ ok: true, finalText: "done" }), [], actionById.integrate, ctx);
  await runActionWithUI(driver({ ok: true }), [], actionById.review, ctx);
  assert.deepEqual(said(calls, "report"), []);
  assert.equal(fs.existsSync(path.join(ctx.app.path, ".superwall")), false);
});

test("an agent that stops early shows what it said and fails the action", async () => {
  const calls = recording();
  const ctx = await context();
  await assert.rejects(
    runActionWithUI(driver({ ok: false, finalText: `[STATUS] x\nRan out of room.${"!".repeat(2000)}` }), [], actionById.integrate, ctx),
    /^Error: Integrate the SDK did not complete\.$/,
  );
  assert.deepEqual(said(calls, "spinner.stop"), ["The agent stopped before finishing."]);
  assert.equal(said(calls, "report")[0]?.length, 1500);
  assert.match(said(calls, "report")[0] ?? "", /^Ran out of room\./);

  const quiet = recording();
  await assert.rejects(runActionWithUI(driver({ ok: false }), [], actionById.integrate, ctx), /did not complete/);
  assert.deepEqual(said(quiet, "report"), []);
});

test("a dry run's plan names the agent, the action, the app and what it may touch", async () => {
  const calls = recording();
  printPlan("Claude Code", actionById.review, await context({ priorReport: "earlier" }));
  const note = calls[0]?.value as { value: string; title: string };
  assert.equal(note.title, "Plan");
  assert.match(note.value, /^Agent:    Claude Code\nAction:   Review the setup\nApp:      Acme \(Expo \(React Native\), Expo 51\.0\.0\)\nPath:     .*Acme\nKey:      pk_live_abcdef\nMode:     read-only · report\nPrior:    review report found$/);

  const bare = recording();
  const ctx = await context({ apiKey: "" });
  printPlan("Codex", actionById.integrate, { ...ctx, app: { ...ctx.app, details: undefined } });
  const plan = (bare[0]?.value as { value: string }).value;
  assert.match(plan, /App:      Acme \(Expo \(React Native\)\)/);
  assert.match(plan, /Key:      \(none\)/);
  assert.match(plan, /Mode:     read-write · silent/);
  assert.match(plan, /Prior:    none/);
});
