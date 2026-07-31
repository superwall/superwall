import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { writeTemplate } from "@/core/paywalls/project/template";

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
    "paywalls/pro/app/index.tsx",
    "paywalls/pro/app/layout.tsx",
    "paywalls/pro/app/theme.css",
  ]) {
    assert.ok(fs.existsSync(path.join(target, file)), `missing ${file}`);
  }
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
