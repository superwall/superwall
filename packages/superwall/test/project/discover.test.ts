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
  it("discovers surfaces, pages, messages, and configs in a superwall/ directory", () => {
    const root = scaffold([
      "superwall/messages/en.ts",
      "superwall/messages/es.ts",
      "superwall/paywalls/plus-upgrade/config.ts",
      "superwall/paywalls/plus-upgrade/app/page.tsx",
      "superwall/paywalls/plus-upgrade/app/offer/page.tsx",
      "superwall/paywalls/plus-upgrade/app/layout.tsx",
      "superwall/paywalls/plus-upgrade/messages/en.ts",
      "superwall/funnels/onboarding/config.ts",
      "superwall/funnels/onboarding/app/page.tsx",
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
    expect(paywall?.pages.map((page) => page.route)).toEqual(["/", "/offer"]);
    expect(paywall?.layoutFile).toBeDefined();
    expect(paywall?.configFile).toBeDefined();
    expect(paywall?.messages.map((entry) => entry.locale)).toEqual(["en"]);

    expect(onboarding).toMatchObject({ id: "onboarding", kind: "funnel" });
    expect(onboarding?.configFile).toBeDefined();
    expect(onboarding?.layoutFile).toBeUndefined();
  });

  it("treats a dedicated repo root as the superwall directory", () => {
    const root = scaffold(["paywalls/simple/config.ts", "paywalls/simple/app/page.tsx"]);

    const project = discoverProject(root);

    expect(project.superwallDir).toBe(root);
    expect(project.surfaces).toMatchObject([{ id: "simple", kind: "paywall" }]);
  });

  it("reports diagnostics for invalid IDs and missing pages", () => {
    const root = scaffold([
      "superwall/paywalls/BadName/app/page.tsx",
      "superwall/paywalls/no-pages/config.ts",
      "superwall/paywalls/no-config/app/page.tsx",
      "superwall/funnels/also-no-config/app/page.tsx",
    ]);

    const project = discoverProject(root);

    expect(project.surfaces).toEqual([]);
    expect(project.diagnostics).toEqual([
      "paywalls/BadName: IDs must be lowercase kebab-case",
      "paywalls/no-config has no config.ts — every paywall needs one (definePaywall)",
      "paywalls/no-pages: missing app/page.tsx",
      "funnels/also-no-config has no config.ts — every funnel needs one (definePaywall)",
    ]);
  });

  it("a surface without config.ts is invalid, not silently unconfigured", () => {
    const root = scaffold(["superwall/paywalls/demo/app/page.tsx"]);

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
      scaffold(["superwall/paywalls/demo/config.ts", "superwall/paywalls/demo/app/page.tsx"]),
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
