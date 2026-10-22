import type { Example } from "@/program/command";
import { resolveApiIndex, type DocOperation } from "@/core/api/reference";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ScopeKind = "app" | "project" | "organization";

export interface Operation {
  name: string;
  summary: string;
  method?: Method;
  path?: string;
  args?: string[];
  bind?: Record<string, ScopeKind>;
  list?: boolean;
  destructive?: boolean;
  handler?: string;
  usage?: string;
  flags?: [string, string][];
  details?: string;
  mcp?: false;
  mcpOmit?: readonly string[];
}

export interface Resource {
  name: string;
  summary: string;
  appArg?: boolean;
  operations: Operation[];
  nested?: Resource[];
  related?: [string, string][];
  examples?: readonly Example[];
}

export const LIST_FLAGS: [string, string][] = [
  ["--search <text>", "Only rows whose id, name or identifier contains this"],
  ["--limit <n>", "At most this many rows"],
];

export const SCOPE_PARAMS: Record<string, ScopeKind> = {
  application_id: "app",
  project_id: "project",
  organization_id: "organization",
};

export function findOperation(resource: Resource, name: string): Operation | undefined {
  return resource.operations.find((op) => op.name === name);
}

export async function findSpec(op: Operation): Promise<DocOperation | undefined> {
  const index = await resolveApiIndex().catch(() => undefined);
  return index?.operations.find((candidate) => candidate.path === op.path && candidate.method === op.method);
}

export function findNested(resource: Resource, name: string): Resource | undefined {
  return resource.nested?.find((nested) => nested.name === name);
}

function parsePathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].flatMap(([, param]) => (param === undefined ? [] : [param]));
}

export function positionalParams(op: Operation): string[] {
  if (op.args) return op.args;
  return parsePathParams(op.path ?? "").filter((param) => !op.bind?.[param] && !SCOPE_PARAMS[param]);
}

export function scopeParams(op: Operation): Map<string, ScopeKind> {
  const bound = new Map<string, ScopeKind>();
  for (const param of parsePathParams(op.path ?? "")) {
    const kind = op.bind?.[param] ?? SCOPE_PARAMS[param];
    if (kind) bound.set(param, kind);
  }
  return bound;
}

export interface ScopeField {
  location: "query" | "body";
  name: string;
  kind: ScopeKind;
  type: string;
}

export function scopeFields(op: Operation, spec: DocOperation | undefined): ScopeField[] {
  const query = (spec?.params ?? []).flatMap((param): ScopeField[] => {
    const kind = SCOPE_PARAMS[param.name];
    return param.in === "query" && kind && (param.required || kind === "app") ? [{ location: "query", name: param.name, kind, type: param.type }] : [];
  });
  if (op.method === "GET" || op.method === "DELETE") return query;
  const body = (spec?.body ?? []).flatMap((field): ScopeField[] => {
    const kind = SCOPE_PARAMS[field.name];
    return kind && (field.required || op.method === "POST") ? [{ location: "body", name: field.name, kind, type: field.type }] : [];
  });
  return [...query, ...body];
}

export function argLabel(resource: Resource, param: string): string {
  if (param === "app_user_id") return "<user>";
  if (param === "id") return `<${singular(resource.name)}>`;
  return `<${param.replace(/_id$/, "").replace(/_/g, "-")}>`;
}

export function singular(name: string): string {
  return name.replace(/ies$/, "y").replace(/s$/, "");
}

export function usageOf(resource: Resource, op: Operation): string {
  if (op.usage !== undefined) return op.usage;
  if (resource.appArg) return "<app>";
  return positionalParams(op)
    .map((param) => argLabel(resource, param))
    .join(" ");
}
