export interface ResourceFlags {
  search?: string;
  limit: unknown;
  yes: boolean;
  data: string[];
  fields: Record<string, unknown>;
}

const OWN_FLAGS = new Set(["app", "project", "d", "dryRun", "yes", "search", "limit", "version"]);
const LIST_FLAGS = new Set(["entitlement"]);

export function textOf(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function listOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

export function readResourceFlags(raw: Record<string, unknown>): ResourceFlags {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (OWN_FLAGS.has(key) || value === undefined) continue;
    fields[key] = LIST_FLAGS.has(key) ? listOf(value) : value;
  }
  return { search: textOf(raw.search), limit: raw.limit, yes: raw.yes === true, data: listOf(raw.d), fields };
}

export function fieldName(flag: string): string {
  return flag.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/-/g, "_");
}
