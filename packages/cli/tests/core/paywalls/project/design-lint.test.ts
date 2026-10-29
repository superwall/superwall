import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  formatTokenFinding,
  lintDesignTokens,
  lintSource,
  readTokens,
} from "@/core/paywalls/project/design-lint";
import type { FrameworkProject, FrameworkSurface } from "@/core/paywalls/project/framework";
import { writeSurfaceFiles } from "@/core/paywalls/project/template";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const TOKENS = `
:root {
  --color-accent: #46D7D4; /* the teal */
  --color-fg: rgb(12, 11, 10);
  --color-wash: color-mix(in oklab, var(--color-fg) 4%, transparent);
  --text-base: 1rem;
  --leading-tight: 1.2;
  --weight-medium: 500;
  --tracking-tight: -0.02em;
  --space-4: 16px;
  --space-2: 8px;
  --radius-md: 3px;
}
:root.dark {
  --color-bg: #fff;
}
`;

function project(files: Record<string, string>, surfaces = ["pro"]): { project: FrameworkProject; surfaces: FrameworkSurface[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-lint-"));
  dirs.push(root);
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  const list = surfaces.map((id) => ({
    kind: "paywall" as const,
    id,
    dir: path.join(root, "paywalls", id),
    configFile: path.join(root, "paywalls", id, "config.ts"),
    routes: [],
  }));
  return {
    project: { root, superwallDir: root, marker: "package.json", packageName: "x", surfaces: list, diagnostics: [] },
    surfaces: list,
  };
}

test("a literal a token holds is named with the token, by line", () => {
  const { project: p, surfaces } = project({
    "design/tokens.css": TOKENS,
    "paywalls/pro/app/theme.css": [
      ".a {",
      "  color: #46d7d4;",
      "  background: #FFFFFF;",
      "  padding: 16px 1rem 12px;",
      "  border-radius: 3px;",
      "  font-size: 16px;",
      "  line-height: 1.2;",
      "  font-weight: 500;",
      "  letter-spacing: -0.02em;",
      "  margin: 0 8px;",
      "  width: 16px;",
      "  border: 1px solid rgb(12,11,10);",
      "  --color-accent: #46d7d4;",
      "}",
    ].join("\n"),
  });

  const findings = lintDesignTokens(p, surfaces);
  assert.deepEqual(
    findings.map((finding) => `${finding.line} ${finding.literal} ${finding.tokens.join(",")}`),
    [
      "2 #46d7d4 --color-accent",
      "3 #FFFFFF --color-bg",
      "4 16px --space-4",
      "4 1rem --space-4",
      "5 3px --radius-md",
      "6 16px --text-base",
      "7 1.2 --leading-tight",
      "8 500 --weight-medium",
      "9 -0.02em --tracking-tight",
      "10 8px --space-2",
      "12 rgb(12,11,10) --color-fg",
    ],
  );
  assert.equal(findings[0]?.file, path.join("paywalls", "pro", "app", "theme.css"));
  assert.equal(
    formatTokenFinding(findings[0]!),
    `${path.join("paywalls", "pro", "app", "theme.css")}:2 hard-codes #46d7d4, which the design system holds as var(--color-accent). Use the token so a design-system change reaches it.`,
  );
});

test("components (the paywall's and the shared ones) are read too, style objects included; comments are not", () => {
  const { project: p, surfaces } = project({
    "design/tokens.css": TOKENS,
    "components/Card.tsx": 'export const Card = () => <div style={{ paddingTop: "16px", color: "#46d7d4" }} />;\n',
    "paywalls/pro/components/Row.tsx": "// color: #46d7d4\n/* padding: 16px */\nexport const s = { fontWeight: 500 };\n",
    "paywalls/pro/node_modules/x/index.js": "export const c = { color: '#46d7d4' };\n",
    "paywalls/pro/assets/a.css": ".x { color: #46d7d4 }\n",
    "paywalls/pro/app/notes.md": "color: #46d7d4\n",
  });

  const findings = lintDesignTokens(p, surfaces).map((finding) => `${finding.file}:${finding.line} ${finding.literal}`);
  assert.deepEqual(findings.sort(), [
    "components/Card.tsx:1 #46d7d4",
    "components/Card.tsx:1 16px",
    `${path.join("paywalls", "pro", "components", "Row.tsx")}:3 500`,
  ].sort());
});

test("no tokens file, or tokens that are not single literals, finds nothing", () => {
  const none = project({ "paywalls/pro/app/theme.css": ".a { color: #46d7d4; }" });
  assert.deepEqual(lintDesignTokens(none.project, none.surfaces), []);

  const opaque = project({
    "design/tokens.css": ":root { --font-sans: Manrope, sans-serif; --text-xl: clamp(1rem, 2vw, 2rem); }",
    "paywalls/pro/app/theme.css": ".a { font-size: 1rem; }",
  });
  assert.deepEqual(lintDesignTokens(opaque.project, opaque.surfaces), []);
});

test("a length in a property no token family covers, or a zero, is left alone", () => {
  const index = readTokens(TOKENS);
  assert.deepEqual(lintSource(index, ".a { top: 16px; height: 8px; padding: 0; margin: 0px; }"), []);
  assert.deepEqual(lintSource(index, ".a { font-weight: 400; color: #123456 }"), []);
  assert.deepEqual(lintSource(index, ".a { color: #46d7d4ff }").map((finding) => finding.tokens), [["--color-accent"]]);
});

test("the starter design system the CLI writes passes its own check", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-lint-starter-"));
  dirs.push(root);
  writeSurfaceFiles(root, "pro", "export default {};\n");
  const surface: FrameworkSurface = {
    kind: "paywall",
    id: "pro",
    dir: path.join(root, "paywalls", "pro"),
    configFile: path.join(root, "paywalls", "pro", "config.ts"),
    routes: [],
  };
  const p: FrameworkProject = { root, superwallDir: root, marker: "package.json", packageName: "x", surfaces: [surface], diagnostics: [] };
  assert.deepEqual(lintDesignTokens(p, [surface]).map(formatTokenFinding), []);
});

test("each property of a style object is read on its own, and a CSS value keeps its commas", () => {
  const index = readTokens(TOKENS);
  const found = (text: string) =>
    lintSource(index, text).map((finding) => `${finding.literal} ${finding.tokens.join(",")}`);
  assert.deepEqual(found('const s = { padding: "2px", fontSize: "16px" };'), ["16px --text-base"]);
  assert.deepEqual(found('<div style={{ display: "flex", fontWeight: 500 }} />'), ["500 --weight-medium"]);
  assert.deepEqual(found('const s = { "padding": "8px", "font-size": "1rem" };'), [
    "8px --space-2",
    "1rem --text-base",
  ]);
  assert.deepEqual(found(".a { box-shadow: 0 1px #fff, 0 2px #46d7d4; padding: 0 8px; }"), [
    "#fff --color-bg",
    "#46d7d4 --color-accent",
    "8px --space-2",
  ]);
});
