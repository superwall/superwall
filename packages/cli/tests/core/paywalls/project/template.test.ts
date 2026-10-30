import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { starterConfig, writeSurfaceFiles, writeTemplate } from "@/core/paywalls/project/template";

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
    "DESIGN.md",
    "design/tokens.css",
    "design/base.css",
    "components/Button.tsx",
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
  assert.match(theme, /--sw-background: var\(--color-bg\);\n  --sw-page-inset-bottom: 0px;/);
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

const DESIGN_FILES = ["DESIGN.md", "design/tokens.css", "design/base.css", "components/Button.tsx"];

function read(dir: string, relative: string): string {
  return fs.readFileSync(path.join(dir, relative), "utf8");
}

test("a surface added to a project without a design system brings one, so its imports resolve", () => {
  const target = scratch("surface");
  writeSurfaceFiles(target, "upgrade", starterConfig("Upgrade"));
  for (const file of DESIGN_FILES) assert.ok(fs.existsSync(path.join(target, file)), `missing ${file}`);
  const theme = read(target, "paywalls/upgrade/app/theme.css");
  assert.match(theme, /^@import "@\/design\/tokens\.css";\n@import "@\/design\/base\.css";\n/);
});

test("the design system never replaces the user's own files", () => {
  const target = scratch("design");
  fs.mkdirSync(path.join(target, "design"), { recursive: true });
  fs.mkdirSync(path.join(target, "components"), { recursive: true });
  const mine = { "DESIGN.md": "# Mine\n", "design/tokens.css": ":root { --color-bg: red; }\n", "components/Button.tsx": "export {};\n" };
  for (const [file, content] of Object.entries(mine)) fs.writeFileSync(path.join(target, file), content);

  writeSurfaceFiles(target, "pro", starterConfig("Pro"));

  for (const [file, content] of Object.entries(mine)) assert.equal(read(target, file), content, file);
  assert.match(read(target, "design/base.css"), /\.button--primary/);
});

test("the starter's primary action is the shared Button", () => {
  const target = scratch("template");
  writeTemplate(target);
  const index = read(target, "paywalls/pro/app/index.tsx");
  assert.match(index, /import \{ Button \} from "@\/components\/Button";/);
  assert.match(index, /<Button\n\s+variant="primary"/);
  assert.match(read(target, "components/Button.tsx"), /variant === "primary" \? "button--primary"/);
});

function declared(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens.set(match[1]!, match[2]!);
  return tokens;
}

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, selector);
  return css.slice(start, css.indexOf("\n}", start));
}

test("tokens.css uses only the prefixes the dashboard groups, and dark overrides colours only", () => {
  const target = scratch("tokens");
  writeTemplate(target);
  const tokens = read(target, "design/tokens.css");
  const prefixes = /^--(color|font|text|leading|weight|tracking|space|radius|ease|duration|sw)-/;
  for (const name of declared(tokens).keys()) assert.match(name, prefixes, name);
  for (const name of declared(block(tokens, ":root.dark")).keys()) assert.match(name, /^--color-/, name);
  for (const value of declared(block(tokens, ":root")).values()) {
    assert.doesNotMatch(value, /calc\(/, value);
  }
  assert.match(tokens, /^@import url\("https:\/\/fonts\.googleapis\.com/);
});

test("every var() in base.css and theme.css is a token tokens.css defines", () => {
  const target = scratch("tokens");
  writeTemplate(target);
  const known = new Set(declared(read(target, "design/tokens.css")).keys());
  const theme = read(target, "paywalls/pro/app/theme.css");
  for (const name of declared(theme).keys()) known.add(name);
  for (const file of ["design/base.css", "paywalls/pro/app/theme.css"]) {
    for (const match of read(target, file).matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(known.has(match[1]!), `${file} uses undefined ${match[1]}`);
    }
  }
  assert.doesNotMatch(read(target, "design/base.css"), /#[0-9a-f]{3,8}\b|oklch\(/i);
});
