import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));

const TERMINAL_UI = ["ink", "ink-spinner", "react", "react-reconciler", "scheduler"];

function chunks(): { name: string; source: string }[] {
  assert.ok(
    fs.existsSync(DIST),
    `dist/ is missing — run \`bun run build\` in packages/cli before the tests`,
  );
  return fs
    .readdirSync(DIST)
    .filter((file) => file.endsWith(".js"))
    .map((name) => ({ name, source: fs.readFileSync(path.join(DIST, name), "utf8") }));
}

const STATEMENT = /^(?:import|export)\b[^"']*["']([^"']+)["']/;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']/g;

function bareImports(source: string): string[] {
  const found: string[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue;
    const statement = STATEMENT.exec(line)?.[1];
    if (statement) found.push(statement);
    for (const match of line.matchAll(DYNAMIC)) found.push(match[1] ?? "");
  }
  return found.filter((specifier) => specifier !== "" && !specifier.startsWith("."));
}

test("the terminal UI is bundled, never imported from the user's node_modules", () => {
  const offenders: string[] = [];

  for (const chunk of chunks()) {
    for (const specifier of bareImports(chunk.source)) {
      const pkg = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : (specifier.split("/")[0] ?? "");
      if (TERMINAL_UI.includes(pkg)) offenders.push(`${chunk.name} imports ${specifier}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A hoisted React 19 in the user's project would satisfy these imports and crash " +
      `react-reconciler on startup. Keep them in tsdown.config.ts noExternal.\n${offenders.join("\n")}`,
  );
});

test("exactly one chunk carries React — two copies would break hooks", () => {
  const carrying = chunks()
    .filter((chunk) => chunk.source.includes("REACT_ELEMENT_TYPE"))
    .map((chunk) => chunk.name);

  assert.equal(carrying.length, 1, `React appears in: ${carrying.join(", ") || "no chunk"}`);
});

test("react-devtools-core stays external — bundling it would break the DEV import guard", () => {
  const external = chunks().some((chunk) => bareImports(chunk.source).includes("react-devtools-core"));

  assert.equal(external, true);
});

test("node builtins and heavy runtime deps are still external", () => {
  const all = chunks().flatMap((chunk) => bareImports(chunk.source));

  for (const specifier of ["node:fs", "node:path", "yargs"]) {
    assert.ok(all.includes(specifier), `${specifier} should not be bundled`);
  }
});
