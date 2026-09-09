import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveredSurface, Project } from "../../src/discover";
import {
  findSurface,
  moduleUrl,
  postcssSearchDir,
  projectDependencies,
  projectModule,
  readActionRequest,
  readProjects,
  resolvableFrom,
  slugFor,
  type PreviewProject,
} from "../../src/preview/projects";

const roots: string[] = [];

const scaffold = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-preview-"));
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

const surface = (root: string, id: string, layout = false): DiscoveredSurface => ({
  kind: "paywall",
  id,
  dir: path.join(root, "paywalls", id),
  configFile: path.join(root, "paywalls", id, "config.ts"),
  ...(layout ? { layoutFile: path.join(root, "paywalls", id, "app/layout.tsx") } : {}),
  routes: [{ name: "index", file: path.join(root, "paywalls", id, "app/index.tsx") }],
  messages: [{ locale: "de", file: path.join(root, "paywalls", id, "messages/de.ts") }],
  diagnostics: [],
});

const project = (root: string, surfaces: DiscoveredSurface[]): Project => ({
  root,
  superwallDir: root,
  sharedMessages: [{ locale: "en", file: path.join(root, "messages/en.ts") }],
  surfaces,
  diagnostics: ["one warning"],
});

const entry = (slug: string, root: string, surfaces: DiscoveredSurface[]): PreviewProject => ({
  slug,
  root,
  project: project(root, surfaces),
});

describe("slugFor", () => {
  it("slugs the directory name and numbers collisions", () => {
    const taken = new Set<string>();
    expect(slugFor("/apps/My App", taken)).toBe("my-app");
    expect(slugFor("/other/My_App", taken)).toBe("my-app-2");
    expect(slugFor("/again/my-app", taken)).toBe("my-app-3");
    expect(slugFor("/", new Set())).toBe("project");
  });
});

describe("readProjects", () => {
  it("discovers each root under its slug", () => {
    const discovered = readProjects(["/a/one", "/b/one"], (root) => project(root, []));
    expect(discovered.map((one) => [one.slug, one.root])).toEqual([
      ["one", "/a/one"],
      ["one-2", "/b/one"],
    ]);
  });
});

describe("findSurface", () => {
  const projects = [
    entry("first", "/first", [surface("/first", "pro")]),
    entry("second", "/second", [surface("/second", "pro")]),
  ];

  it("searches every project unless a slug scopes it", () => {
    expect(findSurface(projects, undefined, "paywall", "pro")?.entry.slug).toBe("first");
    expect(findSurface(projects, "second", "paywall", "pro")?.entry.slug).toBe("second");
  });

  it("misses on the wrong kind, id or slug", () => {
    expect(findSurface(projects, undefined, "funnel", "pro")).toBeUndefined();
    expect(findSurface(projects, "third", "paywall", "pro")).toBeUndefined();
  });
});

describe("moduleUrl", () => {
  it("serves files under the vite root by path and others through @fs", () => {
    expect(moduleUrl("/root", "/root/app/index.tsx")).toBe("/app/index.tsx");
    expect(moduleUrl("/root", "/elsewhere/index.tsx")).toBe("/@fs//elsewhere/index.tsx");
  });
});

describe("projectModule", () => {
  it("emits lazy loaders for every route, catalog, config and layout", () => {
    const source = projectModule(
      [entry("app", "/root", [surface("/root", "pro", true), surface("/root", "lite")])],
      "/root",
    );
    expect(source).toContain('kind: "paywall", id: "pro", project: "app"');
    expect(source).toContain(
      '{ name: "index", load: () => import("/paywalls/pro/app/index.tsx") }',
    );
    expect(source).toContain('loadLayout: () => import("/paywalls/pro/app/layout.tsx")');
    expect(source).toContain("loadLayout: undefined");
    expect(source).toContain(
      '{ locale: "de", load: () => import("/paywalls/pro/messages/de.ts") }',
    );
    expect(source).toContain(
      'export const sharedMessages = [{ locale: "en", load: () => import("/messages/en.ts") }]',
    );
    expect(source).toContain('export const diagnostics = ["one warning"]');
  });

  it("has nothing shared when there is no project", () => {
    expect(projectModule([], "/root")).toContain("export const sharedMessages = []");
  });
});

describe("projectDependencies", () => {
  it("lists the paywall project's own dependencies, minus what the framework bundles", () => {
    const root = scaffold({
      "package.json": JSON.stringify({
        dependencies: {
          react: "19",
          "react-dom": "19",
          superwall: "1",
          "@superwall/runtime": "1",
          clsx: "2",
          "framer-motion": "11",
        },
      }),
    });
    expect(projectDependencies(root)).toEqual(["clsx", "framer-motion"]);
  });

  it("is empty for a missing, malformed or dependency-less package.json", () => {
    expect(projectDependencies(scaffold({}))).toEqual([]);
    expect(projectDependencies(scaffold({ "package.json": "{" }))).toEqual([]);
    expect(projectDependencies(scaffold({ "package.json": '"name"' }))).toEqual([]);
    expect(projectDependencies(scaffold({ "package.json": '{"name":"x"}' }))).toEqual([]);
    expect(projectDependencies(scaffold({ "package.json": '{"dependencies":null}' }))).toEqual([]);
  });
});

describe("postcssSearchDir", () => {
  it("finds the first project directory carrying a PostCSS config", () => {
    const bare = scaffold({});
    const configured = scaffold({ ".postcssrc.json": "{}" });
    const projects = [
      entry("bare", bare, []),
      { ...entry("app", configured, []), project: { ...project(configured, []), root: bare } },
    ];
    expect(postcssSearchDir(projects)).toBe(configured);
    expect(postcssSearchDir([entry("bare", bare, [])])).toBeUndefined();
  });
});

describe("resolvableFrom", () => {
  it("tells installed packages from missing ones", () => {
    const resolvable = resolvableFrom(process.cwd());
    expect(resolvable("react")).toBe(true);
    expect(resolvable("@superwall/not-a-package")).toBe(false);
  });
});

describe("readActionRequest", () => {
  it("reads the string fields the studio posts", () => {
    expect(
      readActionRequest('{"action":"push","kind":"paywall","id":"pro","project":"app"}'),
    ).toEqual({ action: "push", kind: "paywall", id: "pro", project: "app" });
  });

  it("treats anything else as an empty request", () => {
    expect(readActionRequest("[]")).toEqual({
      action: undefined,
      project: undefined,
      kind: "",
      id: "",
    });
    expect(readActionRequest('{"action":1,"kind":null}')).toEqual({
      action: undefined,
      project: undefined,
      kind: "",
      id: "",
    });
  });
});
