// @vitest-environment node
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { externalSources, packageTrees } from "../../src/build/externality";

const roots: string[] = [];

const hostApp = (packages: Record<string, string> = {}): string => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "superwall-externality-")));
  roots.push(root);
  const write = (relative: string, content: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write("package.json", JSON.stringify({ name: "my-app" }));
  write("superwall/package.json", JSON.stringify({ name: "my-app-paywalls" }));
  for (const [dir, name] of Object.entries(packages)) {
    write(`${dir}/package.json`, JSON.stringify({ name }));
  }
  return root;
};

const superwallDir = (root: string) => path.join(root, "superwall");

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("externalSources", () => {
  it("says nothing about a project that only imports its own files", () => {
    const root = hostApp();

    expect(
      externalSources(
        [
          path.join(root, "superwall/paywalls/demo/app/page.tsx"),
          path.join(root, "superwall/components/Button.tsx"),
          path.join(root, "superwall/.superwall/entries/paywall/demo/entry.jsx"),
        ],
        superwallDir(root),
      ),
    ).toEqual([]);
  });

  it("names host app source that escapes the project", () => {
    const root = hostApp();

    expect(
      externalSources(
        [path.join(root, "superwall/paywalls/demo/app/page.tsx"), path.join(root, "src/theme.ts")],
        superwallDir(root),
      ),
    ).toEqual(["../src/theme.ts"]);
  });

  it("names a host monorepo's own package — a registry install would not be external", () => {
    const root = hostApp({ "packages/ui": "@acme/ui" });

    expect(
      externalSources([path.join(root, "packages/ui/src/index.tsx")], superwallDir(root)),
    ).toEqual(["../packages/ui/src/index.tsx"]);
  });

  it("never flags node_modules, however deep", () => {
    const root = hostApp();

    expect(
      externalSources(
        [
          path.join(root, "node_modules/react/index.js"),
          path.join(root, "node_modules/.bun/zod@3/node_modules/zod/index.js"),
          path.join(root, "superwall/node_modules/react-dom/client.js"),
        ],
        superwallDir(root),
      ),
    ).toEqual([]);
  });

  it("never flags the framework's own stack — a linked install resolves it outside", () => {
    const root = hostApp();
    const framework = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
    const runtime = createRequire(framework).resolve("@superwall/runtime");
    const protocol = createRequire(runtime).resolve("@superwall/protocol");

    expect(externalSources([framework, runtime, protocol], superwallDir(root))).toEqual([]);
  });

  it("flags a package that merely calls itself superwall — identity, not name", () => {
    const root = hostApp({
      "vendor/fake": "superwall",
      "vendor/fake-scoped": "@superwall/runtime",
    });

    expect(
      externalSources(
        [
          path.join(root, "vendor/fake/src/index.ts"),
          path.join(root, "vendor/fake-scoped/src/index.ts"),
        ],
        superwallDir(root),
      ),
    ).toEqual(["../vendor/fake-scoped/src/index.ts", "../vendor/fake/src/index.ts"]);
  });

  it("skips virtual modules, which have no file to capture", () => {
    const root = hostApp();

    expect(
      externalSources(
        ["\0virtual:superwall/project", "\0vite/preload-helper.js", "virtual:uno.css"],
        superwallDir(root),
      ),
    ).toEqual([]);
  });

  it("strips the query a plugin appends before judging a path", () => {
    const root = hostApp();

    expect(
      externalSources(
        [
          `${path.join(root, "superwall/paywalls/demo/app/styles.css")}?used`,
          `${path.join(root, "src/theme.ts")}?v=abc123`,
        ],
        superwallDir(root),
      ),
    ).toEqual(["../src/theme.ts"]);
  });

  it("reports each file once, sorted, however the graph reached it", () => {
    const root = hostApp();
    const theme = path.join(root, "src/theme.ts");

    expect(
      externalSources(
        [
          path.join(root, "src/z-last.ts"),
          theme,
          `${theme}?used`,
          path.join(root, "src/a-first.ts"),
          theme,
        ],
        superwallDir(root),
      ),
    ).toEqual(["../src/a-first.ts", "../src/theme.ts", "../src/z-last.ts"]);
  });

  it("still flags a file no package.json claims", () => {
    const root = hostApp();
    fs.rmSync(path.join(root, "package.json"));

    expect(externalSources([path.join(root, "src/theme.ts")], superwallDir(root))).toEqual([
      "../src/theme.ts",
    ]);
  });

  it("judges a symlink by where it really points", () => {
    const root = hostApp();
    const real = path.join(root, "node_modules/@acme/ui/index.js");
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, "export default 1;\n");
    const link = path.join(root, "superwall/linked-ui.js");
    fs.symlinkSync(real, link);

    expect(externalSources([link], superwallDir(root))).toEqual([]);
  });
});

describe("packageTrees", () => {
  it("walks the framework stack, each package resolved from the last", () => {
    const resolved: string[] = [];
    const root = hostApp({
      "vendor/runtime": "@superwall/runtime",
      "vendor/protocol": "@superwall/protocol",
    });
    const trees = packageTrees(root, (fromDir, specifier) => {
      resolved.push(`${path.relative(root, fromDir) || "."}:${specifier}`);
      return path.join(root, "vendor", specifier.split("/")[1]!, "index.js");
    });

    expect(resolved).toEqual([".:@superwall/runtime", "vendor/runtime:@superwall/protocol"]);
    expect(trees.map((tree) => path.relative(root, tree))).toEqual([
      "",
      "vendor/runtime",
      "vendor/protocol",
    ]);
  });

  it("stops at the first package it cannot resolve", () => {
    const root = hostApp();
    expect(
      packageTrees(root, () => {
        throw new Error("not installed");
      }),
    ).toEqual([root]);
  });

  it("stops when a resolved file belongs to no package", () => {
    const root = hostApp();
    const orphan = path.join(path.parse(root).root, "orphan", "index.js");
    expect(packageTrees(root, () => orphan)).toEqual([root]);
  });
});

describe("externalSources through a symlink", () => {
  it("never flags a link whose target lives in the framework's own tree", () => {
    const root = hostApp();
    const framework = path.join(root, "vendor/framework");
    fs.mkdirSync(path.join(framework, "src"), { recursive: true });
    fs.writeFileSync(path.join(framework, "package.json"), JSON.stringify({ name: "superwall" }));
    const real = path.join(framework, "src/index.ts");
    fs.writeFileSync(real, "export default 1;\n");
    const link = path.join(root, "src/linked.ts");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);

    expect(externalSources([link], superwallDir(root), [framework])).toEqual([]);
    expect(externalSources([link], superwallDir(root), [])).toEqual(["../src/linked.ts"]);
  });
});

describe("externalSources judging a link by its target", () => {
  it("never flags a link outside the project that really points into node_modules", () => {
    const root = hostApp();
    const real = path.join(root, "node_modules/@acme/ui/index.js");
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, "export default 1;\n");
    const link = path.join(root, "src/vendored-ui.js");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);

    expect(externalSources([link], superwallDir(root))).toEqual([]);
  });

  it("never flags a link outside the project that really points back into it", () => {
    const root = hostApp();
    const real = path.join(root, "superwall/components/Button.tsx");
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, "export default 1;\n");
    const link = path.join(root, "src/button.tsx");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);

    expect(externalSources([link], superwallDir(root))).toEqual([]);
  });
});
