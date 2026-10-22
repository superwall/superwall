import type { DocField } from "@/core/api/reference";
import type { CatalogTool, FlagSpec, JsonSchema } from "@/program/command";
import { findSpec, positionalParams, SCOPE_PARAMS, scopeFields, scopeParams, type Operation, type Resource } from "./catalog";

const APP: JsonSchema = { type: "string", description: "The app: its id, name, or a dashboard link" };
const SKIPPED = new Set(["yes", "dry_run", "d"]);

export function snakeOf(flag: string): string {
  return flag.replace(/^-+/, "").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/-/g, "_");
}

export function camelOf(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function schemaOfType(type: string, fields?: DocField[]): JsonSchema {
  const trimmed = type.trim();
  if (trimmed.endsWith("[]")) return { type: "array", items: schemaOfType(trimmed.slice(0, -2), fields) };
  const parts = trimmed.split(" | ").map((part) => part.trim());
  if (parts.length > 1 && parts.every((part) => part.startsWith('"'))) {
    return { type: "string", enum: parts.map((part) => JSON.parse(part) as string) };
  }
  if (parts.length > 1) {
    const types = [...new Set(parts.map((part) => schemaOfType(part).type).filter((part) => typeof part === "string"))];
    return types.length ? { type: types as string[] } : {};
  }
  if (trimmed === "object" && fields?.length) return objectOf(fields);
  if (["string", "number", "integer", "boolean", "object", "null"].includes(trimmed)) return { type: trimmed };
  return {};
}

function objectOf(fields: DocField[]): JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field.name, schemaOfField(field)])),
    required: fields.filter((field) => field.required).map((field) => field.name),
  };
}

function schemaOfField(field: DocField): JsonSchema {
  const schema = schemaOfType(field.type, field.fields);
  return field.description ? { ...schema, description: field.description } : schema;
}

function schemaOfFlag(spec: FlagSpec | undefined, describe: string): JsonSchema {
  const type = spec?.type === "list" ? "array" : spec?.type === "number" ? "number" : spec?.type === "boolean" ? "boolean" : "string";
  return type === "array" ? { type, items: { type: "string" }, description: describe } : { type, description: describe };
}

async function toolOf(owner: Resource, resource: Resource, op: Operation, flags: Readonly<Record<string, FlagSpec>>): Promise<CatalogTool> {
  const words = owner === resource ? [op.name] : [resource.name, op.name];
  const positionals = owner.appArg ? [] : positionalParams(op);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const param of positionals) {
    properties[param] = { type: "string", description: param === "id" ? `The ${resource.name.replace(/s$/, "")} id` : param };
    required.push(param);
  }
  const spec = op.method && op.path ? await findSpec(op) : undefined;
  const scoped = [...scopeParams(op).values(), ...scopeFields(op, spec).map((field) => field.kind)];
  if (owner.appArg || scoped.length > 0 || op.handler) properties.app = APP;
  if (scoped.includes("project") && !scoped.includes("app")) {
    properties.project = { type: "string", description: "The project id, when --app doesn't settle it" };
  }
  const known = new Set([...positionals, ...scopeParams(op).keys(), ...Object.keys(SCOPE_PARAMS)]);
  for (const param of spec?.params ?? []) {
    if (param.in !== "query" || known.has(param.name) || param.name === "starting_after" || param.name === "ending_before") continue;
    properties[param.name] = schemaOfField(param);
    if (param.required) required.push(param.name);
  }
  for (const field of spec?.body ?? []) {
    if (known.has(field.name)) continue;
    properties[field.name] = schemaOfField(field);
    if (field.required) required.push(field.name);
  }
  for (const [flag, describe] of op.flags ?? []) {
    const name = snakeOf(flag.split(/[ ,]/).find((part) => part.startsWith("--")) ?? "");
    if (!name || SKIPPED.has(name) || properties[name]) continue;
    properties[name] = schemaOfFlag(flags[camelOf(name)], describe);
  }

  for (const flag of op.usage?.match(/--[a-z][a-z-]*/g) ?? []) {
    const name = snakeOf(flag);
    properties[name] ??= { type: "string" };
    if (!required.includes(name)) required.push(name);
  }

  for (const name of op.mcpOmit ?? []) {
    delete properties[name];
  }

  const readOnly = op.method === "GET" || op.name === "list" || op.name === "get";
  const effect = op.destructive ? "destructive" : readOnly ? "read" : "write";
  return {
    words,
    summary: op.summary,
    details: op.details,
    positionals,
    input: { properties, required },
    effect: op.mcp ?? effect,
  };
}

export async function listResourceTools(owner: Resource, flags: Readonly<Record<string, FlagSpec>>): Promise<CatalogTool[]> {
  const pairs = [owner, ...(owner.nested ?? [])].flatMap((resource) => resource.operations.map((op) => [resource, op] as const));
  return Promise.all(pairs.map(([resource, op]) => toolOf(owner, resource, op, flags)));
}
