import { DASHBOARD_URL } from "@/environment";
import type { CommandContext } from "@/command";
import { blocks } from "@/output";
import { ui } from "@/ui";
import { stripReport } from "@/ui/log";
import { saveReport } from "@/core/state/reports";
import { runAction } from "@/core/agent/run";
import { buildCopyPrompt } from "@/core/agent/prompt";
import { copyToClipboard } from "@/clipboard";
import {
  actionById,
  type ActionContext,
  type ActionId,
  type WizardAction,
} from "@/core/agent/actions";
import type { AgentDriver } from "@/core/agent/drivers";

export async function copyIntegrationPrompt(context: ActionContext): Promise<void> {
  const prompt = buildCopyPrompt(actionById.integrate, context);
  const copied = await copyToClipboard(prompt);
  if (copied) {
    ui.note(
      "Paste it into Claude Code, Codex, Cursor, or another coding agent.",
      "Integration prompt copied to clipboard",
    );
  } else {
    ui.note(prompt, "Integration prompt (copy it manually)");
  }
}

export async function runActionWithUI(
  driver: AgentDriver,
  fallbackDrivers: AgentDriver[],
  action: WizardAction,
  context: ActionContext,
): Promise<void> {
  const spin = ui.spinner();
  spin.start(action.runningLabel);
  const result = await runAction({
    driver,
    fallbackDrivers,
    action,
    ctx: context,
    onEvent: (event) => {
      if (event.type === "status") spin.message(event.text);
    },
  });
  if (!result.ok) {
    spin.stop("The agent stopped before finishing.");
    if (result.finalText) ui.report(stripReport(result.finalText).slice(0, 1500));
    throw new Error(`${action.title} did not complete.`);
  }

  spin.stop(action.successLabel);
  if (action.outputMode === "report" && result.finalText) {
    const report = stripReport(result.finalText);
    saveReport(context.app.path, action.id, report);
    ui.report(report);
  }
}

export function printPlan(agent: string, action: WizardAction, context: ActionContext): void {
  ui.note(
    [
      `Agent:    ${agent}`,
      `Action:   ${action.title}`,
      `App:      ${context.app.name} (${context.app.framework.name}${context.app.details ? `, ${context.app.details}` : ""})`,
      `Path:     ${context.app.path}`,
      `Key:      ${context.apiKey || "(none)"}`,
      `Mode:     ${action.capabilities.filesystem === "read" ? "read-only" : "read-write"} · ${action.outputMode}`,
      `Prior:    ${context.priorReport ? "review report found" : "none"}`,
    ].join("\n"),
    "Plan",
  );
}

export function finish(context: CommandContext, action: WizardAction): void {
  const steps: Partial<Record<ActionId, string[]>> = {
    integrate: [
      "Set up the dashboard (campaign + paywall) so the placement presents something.",
      "Verify on device for placement 'campaign_trigger'.",
    ],
    "placements-implement": ["Set up the dashboard so the new placements present paywalls."],
    "dashboard-setup": [
      "Design the paywall and attach products in the dashboard.",
      "Verify on device.",
    ],
  };
  const finalBlocks = [blocks.nextSteps(steps[action.id] ?? [])];
  if (action.id !== "review" && action.id !== "review-fix") {
    finalBlocks.push(blocks.outro(`Done.  ${DASHBOARD_URL}`));
  }
  context.output.render(...finalBlocks);
}
