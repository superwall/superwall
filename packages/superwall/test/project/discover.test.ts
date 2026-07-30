import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "../../src/discover";

const roots: string[] = [];

const scaffold = (files: string[] | Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-discover-"));
  roots.push(root);
  const entries = Array.isArray(files)
    ? files.map((file): [string, string] => [file, "export default {}\n"])
    : Object.entries(files);
  for (const [file, content] of entries) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("discoverProject", () => {
  it("discovers surfaces, routes, messages, and configs in a superwall/ directory", () => {
    const root = scaffold([
      "superwall/messages/en.ts",
      "superwall/messages/es.ts",
      "superwall/paywalls/plus-upgrade/config.ts",
      "superwall/paywalls/plus-upgrade/app/layout.tsx",
      "superwall/paywalls/plus-upgrade/app/index.tsx",
      "superwall/paywalls/plus-upgrade/app/plans.tsx",
      "superwall/paywalls/plus-upgrade/app/onboarding/index.tsx",
      "superwall/paywalls/plus-upgrade/app/onboarding/goals.tsx",
      "superwall/paywalls/plus-upgrade/messages/en.ts",
      "superwall/funnels/onboarding/config.ts",
      "superwall/funnels/onboarding/app/index.tsx",
    ]);

    const project = discoverProject(root);

    expect(project.superwallDir).toBe(path.join(root, "superwall"));
    expect(project.sharedMessages.map((entry) => entry.locale)).toEqual(["en", "es"]);
    expect(project.diagnostics).toEqual([]);

    expect(project.surfaces).toHaveLength(2);
    const [onboarding, paywall] = [
      project.surfaces.find((surface) => surface.kind === "funnel"),
      project.surfaces.find((surface) => surface.kind === "paywall"),
    ];

    expect(paywall).toMatchObject({ id: "plus-upgrade", kind: "paywall" });
    expect(paywall?.routes.map((route) => route.name)).toEqual([
      "index",
      "onboarding",
      "onboarding/goals",
      "plans",
    ]);
    expect(paywall?.layoutFile).toBeDefined();
    expect(paywall?.configFile).toBeDefined();
    expect(paywall?.messages.map((entry) => entry.locale)).toEqual(["en"]);

    expect(onboarding).toMatchObject({ id: "onboarding", kind: "funnel" });
    expect(onboarding?.configFile).toBeDefined();
    expect(onboarding?.routes.map((route) => route.name)).toEqual(["index"]);
  });

  it("treats a dedicated repo root as the superwall directory", () => {
    const root = scaffold(["paywalls/simple/config.ts", "paywalls/simple/app/index.tsx"]);

    const project = discoverProject(root);

    expect(project.superwallDir).toBe(root);
    expect(project.surfaces).toMatchObject([{ id: "simple", kind: "paywall" }]);
  });

  it("reports diagnostics for invalid IDs, a missing index, and a missing layout", () => {
    const root = scaffold([
      "superwall/paywalls/BadName/app/index.tsx",
      "superwall/paywalls/no-routes/config.ts",
      "superwall/paywalls/no-config/app/index.tsx",
      "superwall/funnels/also-no-config/app/index.tsx",
    ]);

    const project = discoverProject(root);

    expect(project.surfaces).toEqual([]);
    expect(project.diagnostics).toEqual([
      "paywalls/BadName: IDs must be lowercase kebab-case",
      "paywalls/no-config has no config.ts — every paywall needs one (definePaywall)",
      'paywalls/no-routes: missing app/index.tsx — every paywall starts at "index"',
      "funnels/also-no-config has no config.ts — every funnel needs one (definePaywall)",
    ]);
  });

  it("only a top-level index.tsx satisfies the entry route", () => {
    const project = discoverProject(
      scaffold([
        "superwall/paywalls/demo/config.ts",
        "superwall/paywalls/demo/app/onboarding/index.tsx",
      ]),
    );

    expect(project.surfaces).toEqual([]);
    expect(project.diagnostics).toEqual([
      'paywalls/demo: missing app/index.tsx — every paywall starts at "index"',
    ]);
  });

  it("app/ holds routes only — a stray file is a diagnostic, never a silent skip", () => {
    const project = discoverProject(
      scaffold([
        "superwall/paywalls/demo/config.ts",
        "superwall/paywalls/demo/app/index.tsx",
        "superwall/paywalls/demo/app/PlanCard.tsx",
        "superwall/paywalls/demo/app/_helper.tsx",
        "superwall/paywalls/demo/app/util.ts",
        "superwall/paywalls/demo/app/notes.md",
        "superwall/paywalls/demo/app/_shared/thing.tsx",
      ]),
    );

    expect(project.surfaces[0]?.routes.map((route) => route.name)).toEqual(["index"]);
    expect(project.diagnostics).toHaveLength(1);
    expect(project.diagnostics[0]).toBe(
      [
        "paywalls/demo: 5 files in app/ are not routes, so they were skipped:",
        "  PlanCard.tsx  not lowercase kebab-case",
        "  _helper.tsx   not lowercase kebab-case",
        "  _shared/      not lowercase kebab-case",
        "  notes.md      not a .tsx file",
        "  util.ts       not a .tsx file",
        "",
        "Move them out of app/ — it holds routes, layout.tsx, and stylesheets.",
      ].join("\n"),
    );
  });

  it("a lowercase component in app/ is caught by the missing default export", () => {
    const project = discoverProject(
      scaffold({
        "superwall/paywalls/demo/config.ts": "export default {}\n",
        "superwall/paywalls/demo/app/index.tsx": "export default () => null\n",
        "superwall/paywalls/demo/app/header.tsx": "export const Header = () => null\n",
      }),
    );

    expect(project.surfaces[0]?.routes.map((route) => route.name)).toEqual(["index"]);
    expect(project.diagnostics).toEqual([
      [
        "paywalls/demo: 1 file in app/ is not a route, so it was skipped:",
        "  header.tsx  no default export",
        "",
        "Move it to components/ — app/ holds routes, layout.tsx, and stylesheets.",
      ].join("\n"),
    ]);
  });

  it("accepts every way of writing a default export", () => {
    const project = discoverProject(
      scaffold({
        "superwall/paywalls/demo/config.ts": "export default {}\n",
        "superwall/paywalls/demo/app/index.tsx": "export default function Index() {}\n",
        "superwall/paywalls/demo/app/plans.tsx":
          "const Plans = () => null\nexport { Plans as default }\n",
        "superwall/paywalls/demo/app/terms.tsx":
          "export const transition = 'fade'\nexport default () => null\n",
      }),
    );

    expect(project.surfaces[0]?.routes.map((route) => route.name)).toEqual([
      "index",
      "plans",
      "terms",
    ]);
    expect(project.diagnostics).toEqual([]);
  });

  it("stylesheets may sit beside the routes that import them", () => {
    const project = discoverProject(
      scaffold([
        "superwall/paywalls/demo/config.ts",
        "superwall/paywalls/demo/app/index.tsx",
        "superwall/paywalls/demo/app/styles.css",
        "superwall/paywalls/demo/app/plans.module.css",
      ]),
    );

    expect(project.surfaces[0]?.routes.map((route) => route.name)).toEqual(["index"]);
    expect(project.diagnostics).toEqual([]);
  });

  it("layout.tsx is reserved at the top level and never becomes a route", () => {
    const project = discoverProject(
      scaffold([
        "superwall/paywalls/demo/config.ts",
        "superwall/paywalls/demo/app/layout.tsx",
        "superwall/paywalls/demo/app/index.tsx",
      ]),
    );

    expect(project.surfaces[0]?.routes.map((route) => route.name)).toEqual(["index"]);
    expect(project.surfaces[0]?.layoutFile).toBeDefined();
    expect(project.diagnostics).toEqual([]);
  });

  it("a surface needs no layout at all", () => {
    const project = discoverProject(
      scaffold(["superwall/paywalls/demo/config.ts", "superwall/paywalls/demo/app/index.tsx"]),
    );

    expect(project.surfaces[0]?.layoutFile).toBeUndefined();
    expect(project.diagnostics).toEqual([]);
  });

  it("a file route and a directory route cannot both claim the same name", () => {
    const project = discoverProject(
      scaffold([
        "superwall/paywalls/demo/config.ts",
        "superwall/paywalls/demo/app/index.tsx",
        "superwall/paywalls/demo/app/plans.tsx",
        "superwall/paywalls/demo/app/plans/index.tsx",
      ]),
    );

    expect(project.surfaces[0]?.routes.map((route) => route.name)).toEqual(["index", "plans"]);
    expect(project.diagnostics).toEqual([
      'paywalls/demo: app/plans/index.tsx and app/plans.tsx are both the route "plans" — keep one',
    ]);
  });

  it("a surface without config.ts is invalid, not silently unconfigured", () => {
    const root = scaffold(["superwall/paywalls/demo/app/index.tsx"]);

    const project = discoverProject(root);

    expect(project.surfaces).toEqual([]);
    expect(project.diagnostics).toEqual([
      "paywalls/demo has no config.ts — every paywall needs one (definePaywall)",
    ]);
  });
});

const packageJson = (extra: Record<string, unknown>) =>
  JSON.stringify({ name: "acme-paywalls", ...extra });

describe("the project marker", () => {
  it("is a package.json that depends on the framework", () => {
    const project = discoverProject(
      scaffold({
        "superwall/package.json": packageJson({ dependencies: { superwall: "^1.0.0" } }),
      }),
    );

    expect(project.marker).toBe("package.json");
    expect(project.packageName).toBe("acme-paywalls");
  });

  it("counts a devDependency or peerDependency on the framework", () => {
    for (const field of ["devDependencies", "peerDependencies"]) {
      const project = discoverProject(
        scaffold({ "superwall/package.json": packageJson({ [field]: { superwall: "*" } }) }),
      );
      expect(project.marker).toBe("package.json");
    }
  });

  it("does not mark a package.json that has nothing to do with superwall", () => {
    const project = discoverProject(
      scaffold({ "superwall/package.json": packageJson({ dependencies: { react: "19.1.0" } }) }),
    );

    expect(project.marker).toBeUndefined();
    expect(project.packageName).toBe("acme-paywalls");
  });

  it("leaves a markerless directory unmarked instead of throwing", () => {
    const project = discoverProject(
      scaffold(["superwall/paywalls/demo/config.ts", "superwall/paywalls/demo/app/index.tsx"]),
    );

    expect(project.marker).toBeUndefined();
    expect(project.packageName).toBeUndefined();
    expect(project.surfaces).toHaveLength(1);
  });

  it("a config.ts at the project root no longer marks anything", () => {
    for (const file of ["superwall/config.ts", "superwall/superwall.config.ts"]) {
      expect(discoverProject(scaffold([file])).marker).toBeUndefined();
    }
  });

  it("survives an unreadable package.json", () => {
    const project = discoverProject(scaffold({ "superwall/package.json": "{ not json" }));

    expect(project.marker).toBeUndefined();
    expect(project.packageName).toBeUndefined();
  });

  it("reports the project's own package name so callers can catch the self-reference trap", () => {
    const project = discoverProject(
      scaffold({
        "superwall/package.json": JSON.stringify({
          name: "superwall",
          dependencies: { superwall: "^1.0.0" },
        }),
      }),
    );

    expect(project.packageName).toBe("superwall");
  });
});
