import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "../../src/discover";

const roots: string[] = [];

const scaffold = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-discover-edges-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
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

describe("discoverProject edge cases", () => {
  it("ignores dotfiles in app/ instead of reporting them as strays", () => {
    const root = scaffold({
      "superwall/paywalls/pro/config.ts": "export default {}\n",
      "superwall/paywalls/pro/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/pro/app/.DS_Store": "",
    });
    const project = discoverProject(root);
    expect(project.surfaces[0]?.routes.map((route) => route.name)).toEqual(["index"]);
    expect(project.diagnostics).toEqual([]);
  });

  it("treats an unreadable or non-object package.json as no package", () => {
    const broken = discoverProject(scaffold({ "superwall/package.json": "{" }));
    expect(broken.marker).toBeUndefined();
    expect(broken.packageName).toBeUndefined();

    const scalar = discoverProject(scaffold({ "superwall/package.json": '"x"' }));
    expect(scalar.packageName).toBeUndefined();
  });

  it("reads the framework dependency without a name", () => {
    const project = discoverProject(
      scaffold({ "superwall/package.json": '{"devDependencies":{"superwall":"1"}}' }),
    );
    expect(project.marker).toBe("package.json");
    expect(project.packageName).toBeUndefined();
  });
});
