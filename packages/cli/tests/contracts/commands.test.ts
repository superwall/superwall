import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import ts from "typescript";
import type { AnyCommand } from "@/program/command";
import { renderCommand, renderRoot } from "@/program/help";
import { GROUPS, type Group } from "@/commands/registry";

const COMMANDS = fileURLToPath(new URL("../../src/commands/", import.meta.url));
const registered = GROUPS.flatMap((group) => group.commands.map((command) => ({ group, command })));
const files = readdirSync(COMMANDS)
  .filter((entry) => statSync(join(COMMANDS, entry)).isDirectory())
  .flatMap((dir) => {
    return readdirSync(join(COMMANDS, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => statSync(join(COMMANDS, dir, file)).isFile())
      .map((file) => ({ dir, file, path: join(COMMANDS, dir, file) }));
  });

const fileName = (group: Group, command: AnyCommand) => {
  const words = command.name.split(" ");
  const path = words[0] === group.prefix ? words.slice(1) : words;
  const folder = Object.entries(group.folders ?? {}).find(([, names]) => names.includes(command.name))?.[0];
  return `${[...(folder ? [folder] : []), ...(path.length ? path : [group.prefix])].join("/")}.ts`;
};

test("src/commands holds the registry and one directory per help section, nothing else", () => {
  const ids = GROUPS.map((group) => group.id);
  for (const entry of readdirSync(COMMANDS)) {
    if (entry === "registry.ts") continue;
    assert.ok(statSync(join(COMMANDS, entry)).isDirectory(), `${entry} must be a help-section directory`);
    assert.ok(ids.includes(entry), `src/commands/${entry} is not a group in the registry`);
  }
  for (const { dir, file } of files) {
    assert.ok(file.endsWith(".ts"), `src/commands/${dir}/${file} must be a command file`);
  }
});

test("every command file is registered in its directory's group, under its own name", async () => {
  for (const { dir, file, path } of files) {
    const module: Record<string, unknown> = await import(path);
    assert.deepEqual(Object.keys(module), ["command"], `src/commands/${dir}/${file} must export only \`command\``);
    const entry = registered.find(({ command }) => command === module.command);
    assert.ok(entry, `src/commands/${dir}/${file} is not in the registry`);
    assert.equal(entry.group.id, dir, `${entry.command.name} is registered in ${entry.group.id} but lives in ${dir}`);
    const expected = fileName(entry.group, entry.command);
    assert.equal(file, expected, `${entry.command.name} must live in src/commands/${dir}/${expected}`);
  }
  for (const { group, command } of registered) {
    const expected = `${group.id}/${fileName(group, command)}`;
    assert.ok(files.some(({ dir, file }) => `${dir}/${file}` === expected), `${command.name} has no src/commands/${expected}`);
  }
});

test("every command file has a test at the same path under tests/commands", () => {
  const TESTS = fileURLToPath(new URL("../commands/", import.meta.url));
  for (const { dir, file } of files) {
    const mirrored = join(TESTS, dir, file.replace(/\.ts$/, ".test.ts"));
    assert.ok(existsSync(mirrored), `src/commands/${dir}/${file} has no tests/commands/${dir}/${file.replace(/\.ts$/, ".test.ts")}`);
  }
});

test("a group's folders hold only its own commands, each in one folder", () => {
  for (const group of GROUPS) {
    const names = Object.values(group.folders ?? {}).flat();
    assert.equal(new Set(names).size, names.length, `${group.id}: a command is in two folders`);
    for (const name of names) {
      assert.ok(group.commands.some((command) => command.name === name), `${group.id}: folder lists unknown "${name}"`);
    }
  }
});

test("command names are unique, and every name's leading words are a help topic", () => {
  const names = registered.map(({ command }) => command.name);
  assert.equal(new Set(names).size, names.length, "two commands share a name");
  const topics = new Set(GROUPS.flatMap((group) => (group.topics ?? []).map((topic) => topic.name)));
  const catalogs = new Set(registered.filter(({ command }) => command.kind === "catalog").map(({ command }) => command.name));
  for (const name of names) {
    const words = name.split(" ");
    for (let length = 1; length < words.length; length++) {
      const parent = words.slice(0, length).join(" ");
      assert.ok(
        topics.has(parent) || catalogs.has(parent),
        `"${parent}" needs a topic, so \`superwall ${parent}\` explains ${name}`,
      );
    }
  }
  for (const group of GROUPS) {
    for (const topic of group.topics ?? []) {
      const children = group.commands.filter((command) => command.name.startsWith(`${topic.name} `));
      assert.ok(children.length > 0, `topic "${topic.name}" has no commands in ${group.id}`);
    }
  }
});

test("every command describes itself the same way: summary, flags, arguments, examples", () => {
  for (const { command } of registered) {
    assert.match(command.summary, /^[A-Z].*[^.]$/, `${command.name}: a summary starts upper-case and has no period`);
    assert.ok(command.examples.length > 0, `${command.name}: needs at least one example`);
    for (const [example, describe] of command.examples) {
      assert.ok(
        example === command.name || example.startsWith(`${command.name} `),
        `${command.name}: example "${example}" must run this command`,
      );
      assert.match(describe, /^[A-Z]/, `${command.name}: example descriptions start upper-case`);
    }
    for (const [key, spec] of Object.entries(command.flags)) {
      assert.ok(spec.describe.trim(), `${command.name}: --${key} needs a description`);
    }
    if (command.kind === "command") {
      for (const [key, spec] of Object.entries(command.args)) {
        assert.ok(spec.describe.trim(), `${command.name}: <${key}> needs a description`);
      }
      assert.ok(renderCommand(command).includes(command.summary), `${command.name}: help renders`);
    }
  }
});

const SHARED_CORE = new Set(["api", "codebase", "state", "json", "timing"]);

test("a command's logic lives in core at its own group's path", () => {
  for (const { dir, file, path } of files) {
    for (const [, area] of readFileSync(path, "utf8").matchAll(/"@\/core\/([^/"]+)/g)) {
      assert.ok(
        area === dir || SHARED_CORE.has(area ?? ""),
        `src/commands/${dir}/${file} uses src/core/${area}; its logic belongs in src/core/${dir}`,
      );
    }
  }
});

test("command files import no other command and never read raw argv", () => {
  for (const { dir, file, path } of files) {
    const source = readFileSync(path, "utf8");
    const where = `src/commands/${dir}/${file}`;
    assert.doesNotMatch(source, /from "(\.{1,2}\/|@\/commands\/)/, `${where} imports another command; move shared code to src/core`);
    assert.doesNotMatch(source, /\bargv\b/, `${where} reads argv; declare the flag and use the typed input`);
  }
});

test("superwall --help lists every command, folded into its topic or catalog", () => {
  const root = stripVTControlCharacters(renderRoot(GROUPS, ""));
  const rows = new Set([...root.matchAll(/^ {2}(\S+(?: \S+)*?) {2,}/gm)].map(([, name]) => name));
  for (const { command } of registered) {
    const words = command.name.split(" ");
    const shown = words.some((_, index) => rows.has(words.slice(0, index + 1).join(" ")));
    assert.ok(shown, `${command.name} is missing from --help`);
  }
});

test("a topic with sections puts each of its commands in exactly one", () => {
  for (const group of GROUPS) {
    for (const topic of group.topics ?? []) {
      if (!topic.sections) continue;
      const listed = topic.sections.flatMap((section) => section.commands);
      const children = new Set(
        group.commands
          .filter((command) => command.name.startsWith(`${topic.name} `))
          .map((command) => command.name.slice(topic.name.length + 1).split(" ")[0]),
      );
      assert.deepEqual([...listed].sort(), [...children].sort(), `${topic.name}: sections must list each command once`);
    }
  }
});

const ORDER: Record<string, string[]> = {
  defineCommand: ["name", "summary", "summaryOn", "details", "args", "flags", "examples", "auth", "json", "prompts", "mcp", "channel", "run"],
  defineCatalog: ["name", "summary", "summaryOn", "details", "flags", "operations", "help", "tools", "examples", "auth", "json", "prompts", "mcp", "channel", "run"],
  defineResource: ["name", "summary", "appArg", "operations", "nested", "related", "examples"],
  defineAscResource: ["name", "summary", "details", "operations", "examples"],
};
const RUN_LINES = 15;

test("every command file has the same shape: imports, then one command, its keys in one order, a short run", () => {
  for (const { dir, file, path } of files) {
    const where = `src/commands/${dir}/${file}`;
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const statements = source.statements.filter((statement) => !ts.isImportDeclaration(statement));
    assert.equal(statements.length, 1, `${where} holds something besides \`export const command\`; move it to src/core`);
    const [statement] = statements;
    assert.ok(
      statement && ts.isVariableStatement(statement) && statement.getText(source).startsWith("export const command = define"),
      `${where} must be \`export const command = define…({ … })\``,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ORDER[node.expression.text]) {
        const [spec] = node.arguments;
        assert.ok(spec && ts.isObjectLiteralExpression(spec), `${where}: the spec is written inline`);
        const keys = spec.properties.map((property) => (property.name && ts.isIdentifier(property.name) ? property.name.text : "?"));
        const order = ORDER[node.expression.text] ?? [];
        const expected = [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        assert.deepEqual(keys, expected, `${where}: keys go in the order ${order.join(", ")}`);
        for (const property of spec.properties) {
          if (property.name && ts.isIdentifier(property.name) && property.name.text === "run") {
            const lines = property.getText(source).split("\n").length;
            assert.ok(lines <= RUN_LINES, `${where}: run is ${lines} lines; keep it to ${RUN_LINES} and move the work to src/core`);
          }
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }
});
