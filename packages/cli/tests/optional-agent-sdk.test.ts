import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { AGENT_SDK_PACKAGE, AGENT_SDK_VERSION } from "@/core/workflows/agent/drivers/superwall";

const ROOT = join(import.meta.dirname, "..");
const SDK = AGENT_SDK_PACKAGE.replace(/[/.-]/g, "\\$&");
const STATIC_IMPORT = new RegExp(
  String.raw`(?:^|[^\w$.])(?:import|export)\b\s*(?!type\b)(?!\s)(?:[^;'"]*?\bfrom\s*)?["']${SDK}(?:/[^"']*)?["']|\brequire\(\s*["']${SDK}(?:/[^"']*)?["']\s*\)`,
);

function files(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [path] : [];
  });
}

function staticImporters(dir: string, extensions: string[]): string[] {
  return files(dir, extensions)
    .filter((path) => STATIC_IMPORT.test(readFileSync(path, "utf8")))
    .map((path) => relative(ROOT, path));
}

test("the pattern catches a static import and leaves type-only and dynamic ones", () => {
  assert.match(`import { query } from "${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.match(`import * as sdk from "${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.match(`import "${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.match(`export { query } from "${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.match(`const sdk = require("${AGENT_SDK_PACKAGE}");`, STATIC_IMPORT);
  assert.match(`x();import{query as e}from"${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.match(`import { type Options, query } from "${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.match(`}export*from"${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.doesNotMatch(`import type { Options } from "${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
  assert.doesNotMatch(`const sdk = await import("${AGENT_SDK_PACKAGE}");`, STATIC_IMPORT);
  assert.doesNotMatch(`await import(pathToFileURL(join(dir, "${AGENT_SDK_PACKAGE}")).href)`, STATIC_IMPORT);
  assert.doesNotMatch(`const AGENT_SDK_PACKAGE = "${AGENT_SDK_PACKAGE}";`, STATIC_IMPORT);
});

test("no source file imports the agent SDK statically", () => {
  assert.deepEqual(staticImporters(join(ROOT, "src"), [".ts", ".tsx"]), []);
});

test("the built CLI imports the agent SDK nowhere statically", () => {
  const dist = join(ROOT, "dist");
  assert.ok(existsSync(dist), "build the CLI first: bun run build");
  assert.deepEqual(staticImporters(dist, [".js", ".mjs", ".cjs"]), []);
});

test("installing the CLI does not install the agent SDK", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(manifest.dependencies?.[AGENT_SDK_PACKAGE], undefined);
  assert.equal(manifest.optionalDependencies?.[AGENT_SDK_PACKAGE], undefined);
  assert.equal(manifest.peerDependencies?.[AGENT_SDK_PACKAGE], AGENT_SDK_VERSION);
  assert.equal(manifest.peerDependenciesMeta?.[AGENT_SDK_PACKAGE]?.optional, true);
  assert.equal(manifest.devDependencies?.[AGENT_SDK_PACKAGE], AGENT_SDK_VERSION);
});
