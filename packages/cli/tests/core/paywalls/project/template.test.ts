import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { starterConfig, writeTemplate } from "@/core/paywalls/project/template";

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
}

test("the template is a complete project: config, routes, types, ignores", () => {
  const target = path.join(scratch("template"), "My Paywalls!");
  writeTemplate(target);

  for (const file of [
    "package.json",
    "tsconfig.json",
    "superwall.d.ts",
    ".gitignore",
    "README.md",
    "paywalls/pro/config.ts",
    "paywalls/pro/messages/en.ts",
    "paywalls/pro/app/index.tsx",
    "paywalls/pro/app/layout.tsx",
    "paywalls/pro/app/theme.css",
  ]) {
    assert.ok(fs.existsSync(path.join(target, file)), `missing ${file}`);
  }
});

test("the starter's copy lives in messages and reaches the pages through t()", () => {
  const target = path.join(scratch("template"), "app");
  writeTemplate(target);
  const index = fs.readFileSync(path.join(target, "paywalls/pro/app/index.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(target, "paywalls/pro/app/layout.tsx"), "utf8");
  const messages = fs.readFileSync(path.join(target, "paywalls/pro/messages/en.ts"), "utf8");
  for (const key of ["paywall.title", "paywall.cta", "paywall.ctaBare", "paywall.restore", "paywall.close"]) {
    assert.match(index, new RegExp(`t\\("${key.replace(".", "\\.")}"`), key);
  }
  assert.match(layout, /t\("footer\.builtWith"\)/);
  assert.doesNotMatch(index, />\s*Go Pro\s*</);
  assert.match(messages, /cta: "Subscribe · \{price\}"/);
  assert.doesNotMatch(messages, /\$\d/);
});

test("package name comes from the directory, sanitized; superwall floats on latest", () => {
  const target = path.join(scratch("template"), "My Paywalls!");
  writeTemplate(target);

  const parsed = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  assert.equal(parsed.name, "my-paywalls");
  assert.equal(parsed.dependencies.superwall, "latest");
  assert.equal(parsed.private, true);
});

test("superwall.d.ts keeps the augmentation tail, so route types merge instead of replace", () => {
  const target = scratch("template");
  writeTemplate(target);

  const types = fs.readFileSync(path.join(target, "superwall.d.ts"), "utf8");
  assert.match(types, /export type SuperwallRouteName = keyof import\("superwall\/navigation"\)/);
});

test("a directory literally named superwall cannot self-capture the framework import", () => {
  const target = path.join(scratch("template"), "superwall");
  writeTemplate(target);

  const parsed = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  assert.equal(parsed.name, "superwall-project");
});

test("the scaffold theme keeps the pages above the layout's footer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-template-inset-"));
  writeTemplate(dir);
  const theme = fs.readFileSync(path.join(dir, "paywalls", "pro", "app", "theme.css"), "utf8");
  assert.match(theme, /--sw-background: var\(--bg\);\n  --sw-page-inset-bottom: 0px;/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a starter config carries the paywall's name, quoted as code, and nothing else changes", () => {
  const target = path.join(scratch("template"), "app");
  writeTemplate(target);
  const pro = fs.readFileSync(path.join(target, "paywalls/pro/config.ts"), "utf8");

  const named = starterConfig('Say "Hi"');
  assert.match(named, /name: "Say \\"Hi\\""/);
  assert.equal(named.replace('name: "Say \\"Hi\\""', 'name: "Pro"'), pro);
  assert.equal(starterConfig("Pro"), pro);
});
