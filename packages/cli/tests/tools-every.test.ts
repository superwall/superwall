import assert from "node:assert/strict";
import { test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { memoryStore } from "@/core/state/store";
import type { JsonSchema } from "@/program/command";
import { listTools, useToolCache } from "@/tools";
import { PROJECTS } from "./helpers/resources";

const ORG = { id: 3642, name: "Acme" };
const APP = PROJECTS[0]!.applications[0]!;

function permissiveApi(): SuperwallApi {
  const answer = async (_method: string, path: string): Promise<unknown> => {
    if (/^\/v2\/projects(\?|$)/.test(path)) return { data: PROJECTS, has_more: false };
    if (/^\/v2\/organizations(\?|$)/.test(path)) return { data: [ORG], has_more: false };
    return { id: "1", object: "thing", data: [], has_more: false };
  };
  const api = {
    org: { id: String(ORG.id), name: ORG.name },
    userEmail: "jane@example.com",
    host: "https://api.example.com",
    forOrg: () => api,
    list: async (path: string) => {
      const value = (await answer("GET", path)) as { data?: unknown[] };
      return value.data ?? [];
    },
    get: (path: string) => answer("GET", path),
    post: (path: string) => answer("POST", path),
    put: (path: string) => answer("PUT", path),
    patch: (path: string) => answer("PATCH", path),
    del: (path: string) => answer("DELETE", path),
    postText: async () => "{}",
  };
  return api as unknown as SuperwallApi;
}

function sample(schema: JsonSchema | undefined, name: string): unknown {
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type;
  if (schema?.enum?.length) return schema.enum[0];
  if (type === "number" || type === "integer") return 1;
  if (type === "boolean") return true;
  if (type === "array") return [sample(schema?.items, name)];
  if (type === "object") return {};
  if (name === "path") return "/v2/projects";
  if (name === "sql") return "SELECT 1";
  return name === "app" ? String(APP.id) : "1";
}

globalThis.fetch = async () => {
  throw new Error("offline");
};
useToolCache(memoryStore());
const tools = await listTools();

test("every tool answers with JSON: its data, or an error a user can act on", async () => {
  const crashes: string[] = [];
  const tally: Record<string, string> = {};
  for (const tool of tools) {
    const input: Record<string, unknown> = {};
    for (const name of tool.inputSchema.required) input[name] = sample(tool.inputSchema.properties[name], name);
    if (tool.inputSchema.properties.app && input.app === undefined) input.app = String(APP.id);
    let result;
    try {
      result = await tool.run(input, permissiveApi());
    } catch (error) {
      crashes.push(`${tool.name} threw: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    tally[tool.name] = result.ok ? "ok" : String((result.data as { error?: { message?: string } })?.error?.message ?? "reported").slice(0, 90);
    if (result.ok) continue;
    const error = (result.data as { error?: { message?: unknown } } | null)?.error;
    if (result.data !== null && error === undefined) continue;
    const message = String(error?.message ?? "");
    if (!message.trim() || /\b(TypeError|ReferenceError|Cannot read properties|is not a function|undefined)\b/.test(message)) {
      crashes.push(`${tool.name}: ${message || JSON.stringify(result.data)}`);
    }
  }
  assert.deepEqual(crashes, []);
  if (process.env.TALLY) (await import("node:fs")).writeFileSync(process.env.TALLY, JSON.stringify(tally));
});
