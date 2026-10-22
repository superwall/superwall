import pc from "picocolors";
import type { CommandContext } from "@/program/command";
import { rowName, type Row } from "@/core/api/resources";
import { isRecord } from "@/core/json";
import { blocks } from "@/program/output";
import { limitOf, RICH_ROWS, rowMatches } from "./list";

const INLINE_LIST = 72;
const LABEL_KEYS = ["name", "event_name", "identifier", "product_identifier", "title", "description", "url"];
const NESTED_ROWS = 10;
const MAX_DEPTH = 2;

const isScalar = (value: unknown): boolean => value === null || typeof value !== "object";

function scalar(value: unknown): string {
  if (value === null || value === undefined || value === "") return pc.dim("—");
  if (typeof value === "boolean") return value ? pc.green("yes") : pc.dim("no");
  return String(value);
}

function renderObject(value: Record<string, unknown>, indent = "", depth = 0): string[] {
  const keys = Object.keys(value).filter((key) => key !== "object");
  const width = Math.max(0, ...keys.map((key) => key.length)) + 2;
  const out: string[] = [];
  for (const key of keys) {
    const field = value[key];
    const label = `${indent}${pc.dim(key.padEnd(width))}`;
    if (isScalar(field)) {
      out.push(`${label}${scalar(field)}`);
    } else if (Array.isArray(field)) {
      out.push(...renderArray(label, field, indent, depth));
    } else if (isRecord(field) && depth >= MAX_DEPTH) {
      out.push(`${label}${pc.dim(`{ ${Object.keys(field).length} fields }`)}`);
    } else if (isRecord(field)) {
      out.push(`${indent}${pc.dim(key)}`);
      out.push(...renderObject(field, `${indent}  `, depth + 1));
    }
  }
  return out;
}

function renderArray(label: string, items: unknown[], indent: string, depth: number): string[] {
  if (items.length === 0) return [`${label}${pc.dim("none")}`];
  if (items.every(isScalar)) {
    const joined = items.map(String).join(", ");
    return [`${label}${joined.length <= INLINE_LIST ? joined : pc.dim(`${items.length} items`)}`];
  }
  const rows = items.filter(isRecord).slice(0, NESTED_ROWS);
  const lines = [`${label}${pc.dim(`${items.length} item${items.length === 1 ? "" : "s"}`)}`];
  if (depth >= MAX_DEPTH) return lines;
  for (const row of rows) {
    const name = labelOf(row);
    const id = row.id !== undefined && String(row.id) !== name ? pc.dim(`  ${row.id}`) : "";
    lines.push(`${indent}  · ${name}${id}`);
  }
  if (items.length > rows.length) lines.push(pc.dim(`${indent}  … ${items.length - rows.length} more`));
  return lines;
}

function labelOf(row: Record<string, unknown>): string {
  for (const key of LABEL_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
  }
  return rowName(row as Row);
}

export function rowsOf(response: unknown): Row[] {
  if (Array.isArray(response)) return response as Row[];
  if (isRecord(response)) {
    for (const key of ["data", "items", "results", "users", "events", "attempts", "versions"]) {
      if (Array.isArray(response[key])) return response[key] as Row[];
    }
  }
  return response === undefined || response === null ? [] : [response as Row];
}

export function renderRows(
  ctx: CommandContext,
  rows: Row[],
  noun: string,
  flags: { search?: string; limit: unknown },
): void {
  const query = flags.search;
  const matched = query ? rows.filter((row) => rowMatches(row, query)) : rows;
  const limit = limitOf(flags.limit);
  if (ctx.json) return ctx.output.data(matched.slice(0, limit));

  const shown = matched.slice(0, limit ?? RICH_ROWS);
  const count = `${matched.length} ${matched.length === 1 ? noun : `${noun}s`}`;
  ctx.output.render(
    blocks.step(query ? `${count} matching "${query}", of ${rows.length}` : count),
    blocks.list({
      items: shown.map((row) => {
        const label = labelOf(row);
        const meta = [row.identifier, row.id]
          .filter((part) => part !== undefined && part !== null && String(part) !== label)
          .map(String);
        return { label, meta: meta.join("  ") || undefined };
      }),
      empty: query ? `Nothing matches "${query}".` : `No ${noun}s yet.`,
    }),
  );
  if (matched.length > shown.length) {
    ctx.ui.info(`…${matched.length - shown.length} more. Narrow with --search, or pass --limit or --json.`);
  }
}

export function renderValue(ctx: CommandContext, value: unknown, heading?: string): void {
  if (ctx.json) return ctx.output.data(value ?? { ok: true });
  if (heading) ctx.output.render(blocks.success(heading));
  if (value === undefined || value === null || value === "") return;
  if (isRecord(value)) return ctx.output.text(renderObject(value).join("\n"));
  if (Array.isArray(value)) return ctx.output.text(renderArray("", value, "", 0).join("\n"));
  ctx.output.text(String(value));
}
