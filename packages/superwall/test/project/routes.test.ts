import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "../../src/discover";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Builds a one-paywall project whose app/ contains exactly `files`. */
const surfaceWith = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-routes-"));
  roots.push(root);
  const dir = path.join(root, "superwall/paywalls/demo");
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "config.ts"), "export default {}\n");
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, "app", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const project = discoverProject(root);
  return {
    routes: project.surfaces[0]?.routes.map((route) => route.name) ?? [],
    diagnostics: project.diagnostics,
  };
};

const INDEX = "export default () => null\n";

/** Every accepted form produces the route; every rejected one produces exactly one diagnostic. */
const accepts = (source: string) => surfaceWith({ "index.tsx": INDEX, "probe.tsx": source });

describe("a route must default-export its component", () => {
  it("accepts an arrow default", () => {
    expect(accepts("export default () => null\n").routes).toContain("probe");
  });

  it("accepts a function declaration", () => {
    expect(accepts("export default function Probe() { return null }\n").routes).toContain("probe");
  });

  it("accepts a class declaration", () => {
    expect(accepts("export default class Probe {}\n").routes).toContain("probe");
  });

  it("accepts a renamed specifier", () => {
    const source = "const Probe = () => null\nexport { Probe as default }\n";
    expect(accepts(source).routes).toContain("probe");
  });

  it("accepts a re-export of another module's default", () => {
    expect(accepts('export { default } from "../../components/Probe"\n').routes).toContain("probe");
  });

  it("accepts a default sitting among named exports", () => {
    const source = 'export const transition = "fade"\nexport default () => null\n';
    expect(accepts(source).routes).toContain("probe");
  });

  it("accepts a default that is not the first statement", () => {
    const source = 'import * as React from "react"\n\nconst x = 1\n\nexport default () => null\n';
    expect(accepts(source).routes).toContain("probe");
  });

  it("accepts a parenthesized default", () => {
    expect(accepts("export default (() => null)\n").routes).toContain("probe");
  });

  it("rejects a file with only named exports — the component-in-app/ case", () => {
    const result = accepts("export const Probe = () => null\n");

    expect(result.routes).toEqual(["index"]);
    expect(result.diagnostics).toEqual([
      [
        "paywalls/demo: 1 file in app/ is not a route, so it was skipped:",
        "  probe.tsx  no default export",
        "",
        "Move it to components/ — app/ holds routes, layout.tsx, and stylesheets.",
      ].join("\n"),
    ]);
  });

  it("rejects a hook module", () => {
    const source = 'import { useState } from "react"\nexport const useProbe = () => useState(0)\n';
    expect(accepts(source).routes).toEqual(["index"]);
  });

  it("rejects a re-export barrel that forwards no default", () => {
    expect(accepts('export * from "../../components/Probe"\n').routes).toEqual(["index"]);
  });

  it("is not fooled by a named export whose name merely starts with default", () => {
    expect(accepts("export const defaultPlan = 'annual'\n").routes).toEqual(["index"]);
    expect(accepts("export const defaults = {}\n").routes).toEqual(["index"]);
  });

  it("is not fooled by a commented-out default export", () => {
    const line = accepts("// export default () => null\nexport const Probe = () => null\n");
    expect(line.routes).toEqual(["index"]);

    const block = accepts("/* export default () => null */\nexport const Probe = () => null\n");
    expect(block.routes).toEqual(["index"]);
  });

  it("does not mistake a URL's slashes for a comment", () => {
    const source = 'const url = "https://superwall.com"\nexport default () => url\n';
    expect(accepts(source).routes).toContain("probe");
  });

  it("checks nested routes too", () => {
    const result = surfaceWith({
      "index.tsx": INDEX,
      "goals/index.tsx": INDEX,
      "goals/card.tsx": "export const Card = () => null\n",
    });

    expect(result.routes).toEqual(["goals", "index"]);
    expect(result.diagnostics).toEqual([
      [
        "paywalls/demo: 1 file in app/ is not a route, so it was skipped:",
        "  goals/card.tsx  no default export",
        "",
        "Move it to components/ — app/ holds routes, layout.tsx, and stylesheets.",
      ].join("\n"),
    ]);
  });

  it("applies to index.tsx itself — a broken entry is not silently a valid surface", () => {
    const result = surfaceWith({ "index.tsx": "export const Index = () => null\n" });

    expect(result.routes).toEqual([]);
    expect(result.diagnostics).toEqual([
      [
        "paywalls/demo: 1 file in app/ is not a route, so it was skipped:",
        "  index.tsx  no default export",
        "",
        "Move it to components/ — app/ holds routes, layout.tsx, and stylesheets.",
      ].join("\n"),
      'paywalls/demo: missing app/index.tsx — every paywall starts at "index"',
    ]);
  });

  it("never applies to layout.tsx, which is not a route", () => {
    const result = surfaceWith({ "index.tsx": INDEX, "layout.tsx": INDEX });

    expect(result.routes).toEqual(["index"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("points .tsx strays at components/, since those really are components", () => {
    const result = surfaceWith({
      "index.tsx": INDEX,
      "PlanCard.tsx": "export const PlanCard = () => null\n",
      "header.tsx": "export const Header = () => null\n",
    });

    expect(result.diagnostics[0]).toContain(
      "Move them to components/ — app/ holds routes, layout.tsx, and stylesheets.",
    );
  });

  it("does not send a hook to components/ — anything not .tsx is just told to leave app/", () => {
    const result = surfaceWith({
      "index.tsx": INDEX,
      "usePlans.ts": "export const usePlans = () => []\n",
    });

    expect(result.diagnostics[0]).toContain(
      "Move it out of app/ — it holds routes, layout.tsx, and stylesheets.",
    );
    expect(result.diagnostics[0]).not.toContain("components/");
  });

  it("falls back to the general remedy as soon as the strays are mixed", () => {
    const result = surfaceWith({
      "index.tsx": INDEX,
      "PlanCard.tsx": "export const PlanCard = () => null\n",
      "usePlans.ts": "export const usePlans = () => []\n",
    });

    expect(result.diagnostics[0]).toContain("Move them out of app/");
  });

  it("treats an unreadable file as a route rather than hiding it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-routes-"));
    roots.push(root);
    const app = path.join(root, "superwall/paywalls/demo/app");
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(root, "superwall/paywalls/demo/config.ts"), "export default {}\n");
    fs.writeFileSync(path.join(app, "index.tsx"), INDEX);
    const unreadable = path.join(app, "plans.tsx");
    fs.writeFileSync(unreadable, INDEX);
    fs.chmodSync(unreadable, 0o000);

    const project = discoverProject(root);

    expect(project.surfaces[0]?.routes.map((route) => route.name)).toContain("plans");
  });
});
