import type { AgentDriver, AgentEvent, AgentResult, AgentRunOptions } from "./drivers";
import type { ActionContext, WizardAction } from "./actions";
import { buildActionPrompt, getCommandments } from "./prompt";

export interface RunActionOptions {
  driver: AgentDriver;
  fallbackDrivers?: AgentDriver[];
  action: WizardAction;
  ctx: ActionContext;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export async function runAction(opts: RunActionOptions): Promise<AgentResult> {
  return runWithDriverFallback([opts.driver, ...(opts.fallbackDrivers ?? [])], {
    prompt: buildActionPrompt(opts.action, opts.ctx),
    cwd: opts.ctx.app.path,
    systemAppend: getCommandments(),
    capabilities: opts.action.capabilities,
    onEvent: opts.onEvent,
    signal: opts.signal,
  });
}

export async function runWithDriverFallback(
  drivers: AgentDriver[],
  options: AgentRunOptions,
): Promise<AgentResult> {
  if (drivers.length === 0) throw new Error("No agent driver available.");

  let result: AgentResult = { ok: false };
  for (const driver of drivers) {
    result = await driver.run(options);
    if (result.ok || result.failureReason !== "usage-limit") return result;
  }
  return result;
}
