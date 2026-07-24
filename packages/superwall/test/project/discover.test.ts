import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "../../src/discover";

const roots: string[] = [];

const scaffold = (files: string[]): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-discover-"));
  roots.push(root);
  for (const file of files) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "export default {}\n");
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
      "superwall/config.ts",
      "superwall/messages/en.ts",
      "superwall/messages/es.ts",
      "superwall/paywalls/plus-upgrade/config.ts",
      "superwall/paywalls/plus-upgrade/app/page.tsx",
      "superwall/paywalls/plus-upgrade/app/offer/page.tsx",
      "superwall/paywalls/plus-upgrade/app/layout.tsx",
      "superwall/paywalls/plus-upgrade/messages/en.ts",
      "superwall/funnels/onboarding/app/page.tsx",
    ]);

    const project = discoverProject(root);

    expect(project.superwallDir).toBe(path.join(root, "superwall"));
    expect(project.appConfigFile).toBe(path.join(root, "superwall/config.ts"));
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
    expect(onboarding?.configFile).toBeUndefined();
    expect(onboarding?.layoutFile).toBeUndefined();
  });

  it("treats a dedicated repo root as the superwall directory", () => {
    const root = scaffold(["paywalls/simple/app/page.tsx"]);

    const project = discoverProject(root);

    expect(project.superwallDir).toBe(root);
    expect(project.surfaces).toMatchObject([{ id: "simple", kind: "paywall" }]);
  });

  it("reports diagnostics for invalid IDs and missing pages", () => {
    const root = scaffold([
      "superwall/paywalls/BadName/app/page.tsx",
      "superwall/paywalls/no-pages/config.ts",
    ]);

    const project = discoverProject(root);

    expect(project.surfaces).toEqual([]);
    expect(project.diagnostics).toEqual([
      "paywalls/BadName: IDs must be lowercase kebab-case",
      "paywalls/no-pages: missing app/page.tsx",
    ]);
  });
});
