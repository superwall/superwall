import { type CommandContext } from "@/program/command";
import { type AsaOperation } from "@/core/apple-search-ads/catalog";
import { type AsaPage } from "@/core/apple-search-ads/operations";
import { isRecord } from "@/core/json";

export function listOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function rowLabel(row: Record<string, unknown>): string {
  for (const key of ["name", "text", "appName", "displayName", "orgName", "productPageId"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
  }
  return String(row.id ?? row.adamId ?? "");
}

function rowMeta(row: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["status", "servingStatus", "matchType", "state", "type", "countryOrRegion", "currency"]) {
    const v = row[key];
    if (typeof v === "string" && v) parts.push(v);
  }
  const bid = row.bidAmount ?? row.dailyBudgetAmount ?? row.defaultBidAmount;
  if (isRecord(bid) && bid.amount !== undefined) parts.push(`${String(bid.amount)} ${String(bid.currency ?? "")}`.trim());
  const id = row.id ?? row.adamId ?? row.orgId;
  if (id !== undefined) parts.push(String(id));
  return parts.join("  ");
}

export function printResult(ctx: CommandContext, op: AsaOperation, response: AsaPage): void {
  if (ctx.json) return ctx.output.data(response);
  const rows = Array.isArray(response.data) ? response.data.filter(isRecord) : undefined;
  const listing = op.action === "list" || op.action === "find" || op.action === "search" || op.action === "assets";
  if (!rows || !listing) return ctx.output.data(response);
  if (rows.length === 0) return ctx.ui.step(`No ${op.group} found`);
  const total = response.pagination?.totalResults;
  const count = typeof total === "number" && total > rows.length ? `${rows.length} of ${total}` : String(rows.length);
  ctx.ui.step(`${count} ${op.group}`);
  for (const row of rows) ctx.ui.info(`\`${rowLabel(row)}\`  ${rowMeta(row)}`);
}
