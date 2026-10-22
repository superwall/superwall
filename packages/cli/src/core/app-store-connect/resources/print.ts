import type { CommandContext } from "@/program/command";
import { formatJson } from "@/program/output";
import { renderValue } from "@/core/main/views";
import { plural, type AscOutput } from "./operation";
import type { PlannedRequest } from "./session";

export function printAscPlan(ctx: CommandContext, planned: readonly PlannedRequest[]): void {
  if (ctx.json) return ctx.output.data({ dryRun: true, requests: planned });
  ctx.ui.success(`Dry run: nothing was changed. ${plural(planned.length, "request")}:`);
  for (const request of planned) {
    ctx.ui.step(`${request.method} ${request.path}`);
    if (request.body !== undefined) ctx.output.text(formatJson(request.body));
  }
}

export function printAscOutput(ctx: CommandContext, output: AscOutput): void {
  if ("value" in output) return renderValue(ctx, output.value, output.heading);
  if (ctx.json) return ctx.output.data(output.data);
  ctx.ui.step(plural(output.rows.length, output.noun));
  for (const row of output.rows) ctx.ui.info(`\`${row.label}\`${row.meta ? `  ${row.meta}` : ""}`);
}
