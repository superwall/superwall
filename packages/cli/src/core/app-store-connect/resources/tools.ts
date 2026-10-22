import type { CatalogTool, JsonSchema } from "@/program/command";
import type { AscFlag, AscOperation } from "./operation";

const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/-/g, "_");

const COMMON: Record<string, JsonSchema> = {
  app: { type: "string", description: "A Superwall app of the organization whose App Store Connect key to use: id, name or dashboard link" },
  team: { type: "string", description: "Apple team id, when the organization has several" },
};

function schemaOfFlag(flag: AscFlag): JsonSchema {
  if (flag.type === "list") return { type: "array", items: { type: "string" }, description: flag.describe };
  const schema: JsonSchema = { type: flag.type, description: flag.describe };
  return flag.choices ? { ...schema, enum: flag.choices } : schema;
}

function toolOf(operation: AscOperation): CatalogTool {
  const positionals = (operation.args ?? []).map((arg) => snake(arg.name));
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const arg of operation.args ?? []) {
    properties[snake(arg.name)] = { type: "string", description: arg.describe, ...(arg.choices ? { enum: arg.choices } : {}) };
    if (arg.required) required.push(snake(arg.name));
  }
  for (const [key, flag] of Object.entries(operation.flags ?? {})) {
    properties[snake(key)] = schemaOfFlag(flag);
    if (flag.required) required.push(snake(key));
  }
  return {
    words: [operation.name],
    summary: operation.summary,
    details: operation.details,
    positionals,
    input: { properties: { ...properties, ...COMMON }, required },
    effect: operation.effect,
  };
}

export function listAscResourceTools(operations: readonly AscOperation[]): CatalogTool[] {
  return operations.map(toolOf);
}
