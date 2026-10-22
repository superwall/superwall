import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { GROUPS } from "@/commands/registry";
import { listTools } from "@/tools";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const WORKER_SAFE_PACKAGES = new Set(["picocolors"]);

function resolveModule(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : resolve(dirname(from), specifier);
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base].find((candidate) => {
    return existsSync(candidate) && /\.(tsx?|json)$/.test(candidate);
  });
}

function staticImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      const onlyTypes =
        bindings && ts.isNamedImports(bindings) && !statement.importClause?.name && bindings.elements.length > 0
          ? bindings.elements.every((element) => element.isTypeOnly)
          : false;
      if (!onlyTypes && ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function nodeReach(entry: string): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  const stack: [string, string[]][] = [[entry, []]];
  while (stack.length) {
    const [file, path] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".json")) continue;
    for (const specifier of staticImports(file)) {
      const chain = [...path, file.slice(SRC.length)];
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const next = resolveModule(file, specifier);
        if (next) stack.push([next, chain]);
        continue;
      }
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
      if (!WORKER_SAFE_PACKAGES.has(name)) problems.push(`${specifier}  ←  ${chain.join(" → ")}`);
    }
  }
  return problems;
}

test("the MCP tools load in a Worker: nothing they import statically needs Node", () => {
  const problems = nodeReach(join(SRC, "tools.ts"));
  assert.deepEqual(
    problems,
    [],
    "src/tools.ts reaches these; a CLI-only command imports its core with `await import()` inside run, and a tool's core goes through the host",
  );
});

test("every command says what it is on MCP, and a tool answers --json", () => {
  for (const command of GROUPS.flatMap((group) => group.commands)) {
    assert.ok(["read", "write", "destructive", false].includes(command.mcp), `${command.name}: mcp`);
    if (command.mcp !== false) assert.equal(command.json, true, `${command.name} is an MCP tool, so it must answer --json`);
  }
});

test("tool names are unique and valid MCP names, and every tool describes itself", async () => {
  const tools = await listTools();
  const names = tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length, "two tools share a name");
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z0-9_]{1,64}$/, `${tool.name}: MCP tool names are lowercase words and underscores`);
    assert.ok(tool.description.trim(), `${tool.name} needs a description`);
    for (const required of tool.inputSchema.required) {
      assert.ok(tool.inputSchema.properties[required], `${tool.name}: required "${required}" isn't a property`);
    }
  }
});
