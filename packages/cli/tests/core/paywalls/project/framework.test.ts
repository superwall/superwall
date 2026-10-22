import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  FrameworkNotFoundError,
  frameworkVersion,
  resolveFramework,
  resolveFrameworkDir,
} from "@/core/paywalls/project/framework";

const dirs: string[] = [];

function scaffold(pkg: unknown, exports: Record<string, string> = {}): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "superwall-framework-")));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "app" }));

  const installed = path.join(dir, "node_modules/superwall");
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(
    path.join(installed, "package.json"),
    typeof pkg === "string" ? pkg : JSON.stringify(pkg),
  );
  for (const [file, source] of Object.entries(exports)) {
    fs.writeFileSync(path.join(installed, file), source);
  }
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolves the framework the project itself has installed", () => {
  const dir = scaffold({ name: "superwall", version: "1.4.2" });

  assert.equal(resolveFrameworkDir(dir), path.join(dir, "node_modules/superwall"));
  assert.equal(frameworkVersion(dir), "1.4.2");
});

test("a project without superwall says how to install it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-framework-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), "{}");

  assert.throws(() => resolveFrameworkDir(dir), FrameworkNotFoundError);
  assert.throws(() => resolveFrameworkDir(dir), /npm i superwall/);
  assert.equal(frameworkVersion(dir), "unknown");
});

test("a version the CLI cannot read never crashes a push", () => {
  assert.equal(frameworkVersion(scaffold("{ not json")), "unknown");
  assert.equal(frameworkVersion(scaffold({ name: "superwall" })), "unknown");
  assert.equal(frameworkVersion(scaffold({ name: "superwall", version: "" })), "unknown");
  assert.equal(frameworkVersion(scaffold({ name: "superwall", version: 3 })), "unknown");
  assert.equal(frameworkVersion(scaffold("null")), "unknown");
});

test("loading a framework whose subpaths are missing names the dependency to update", async () => {
  const dir = scaffold(
    {
      name: "superwall",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": "./index.js",
        "./discover": "./discover.js",
        "./build": "./build.js",
        "./preview": "./preview.js",
        "./package.json": "./package.json",
      },
    },
    {
      "discover.js": "export const discoverProject = () => ({});\n",
      "build.js": "export const nothingUseful = 1;\n",
      "preview.js": "export const startPreviewServer = async () => ({});\n",
    },
  );

  await assert.rejects(
    resolveFramework(dir),
    /does not export buildSnapshot from superwall\/build — update the project's superwall dependency/,
  );
});

test("a framework that loads cleanly exposes the three entry points", async () => {
  const dir = scaffold(
    {
      name: "superwall",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": "./index.js",
        "./discover": "./discover.js",
        "./build": "./build.js",
        "./preview": "./preview.js",
        "./package.json": "./package.json",
      },
    },
    {
      "discover.js": "export const discoverProject = (root) => ({ root, surfaces: [] });\n",
      "build.js": "export const buildSnapshot = async () => ({ bytes: 1 });\n",
      "preview.js": "export const startPreviewServer = async () => ({ ok: true });\n",
    },
  );

  const framework = await resolveFramework(dir);
  assert.equal(typeof framework.discoverProject, "function");
  assert.equal(typeof framework.buildSnapshot, "function");
  assert.equal(typeof framework.startPreviewServer, "function");
  assert.deepEqual(framework.discoverProject("/x"), { root: "/x", surfaces: [] });
  assert.equal(framework.studioProject, undefined);
});

test("a framework whose preview builds studio projects exposes that too", async () => {
  const dir = scaffold(
    {
      name: "superwall",
      version: "1.0.0",
      type: "module",
      exports: {
        "./discover": "./discover.js",
        "./build": "./build.js",
        "./preview": "./preview.js",
        "./package.json": "./package.json",
      },
    },
    {
      "discover.js": "export const discoverProject = () => ({});\n",
      "build.js": "export const buildSnapshot = async () => ({});\n",
      "preview.js":
        "export const startPreviewServer = async () => ({});\n" +
        "export const buildStudioProject = async (root) => ({ root, surfaces: [] });\n",
    },
  );

  const framework = await resolveFramework(dir);
  assert.deepEqual(await framework.studioProject?.("/x"), { root: "/x", surfaces: [] });
});

test("a framework built as CommonJS loads the same entry points", async () => {
  const dir = scaffold(
    {
      name: "superwall",
      version: "1.0.0",
      exports: {
        "./discover": "./discover.cjs",
        "./build": "./build.cjs",
        "./preview": "./preview.cjs",
        "./package.json": "./package.json",
      },
    },
    {
      "discover.cjs": 'Object.defineProperty(exports, "__esModule", { value: true });\nexports.discoverProject = (root) => ({ root });\n',
      "build.cjs": 'Object.defineProperty(exports, "__esModule", { value: true });\nexports.buildSnapshot = async () => ({});\n',
      "preview.cjs": 'Object.defineProperty(exports, "__esModule", { value: true });\nexports.startPreviewServer = async () => ({});\n',
    },
  );

  const framework = await resolveFramework(dir);
  assert.deepEqual(framework.discoverProject("/x"), { root: "/x" });
  assert.equal(typeof framework.buildSnapshot, "function");
  assert.equal(framework.studioProject, undefined);
});

test("a framework too old to export an entry point fails on that entry point", async () => {
  const dir = scaffold(
    {
      name: "superwall",
      version: "0.1.0",
      type: "module",
      exports: { "./discover": "./discover.js", "./build": "./build.js", "./package.json": "./package.json" },
    },
    {
      "discover.js": "export const discoverProject = () => ({});\n",
      "build.js": "export const buildSnapshot = async () => ({});\n",
    },
  );

  await assert.rejects(resolveFramework(dir), (error: NodeJS.ErrnoException) => {
    assert.equal(error.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
    assert.match(error.message, /\.\/preview/);
    return true;
  });
});

test("loading from a project with no framework at all reports it as missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-framework-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), "{}");

  await assert.rejects(resolveFramework(dir), FrameworkNotFoundError);
});

function install(at: string, version = "2.0.0"): void {
  const installed = path.join(at, "node_modules/superwall");
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(
    path.join(installed, "package.json"),
    JSON.stringify({ name: "superwall", version }),
  );
}

function layout(build: (root: string) => void): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "superwall-layout-")));
  dirs.push(root);
  build(root);
  return root;
}

test("the nested project's install is found from the host root", () => {
  const root = layout((dir) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "host-app" }));
    const nested = path.join(dir, "superwall");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "package.json"), JSON.stringify({ name: "host-app-paywalls" }));
    install(nested, "3.1.0");
  });

  assert.equal(resolveFrameworkDir(root), path.join(root, "superwall/node_modules/superwall"));
  assert.equal(frameworkVersion(root), "3.1.0");
});

test("the same install is found from inside the project directory", () => {
  const root = layout((dir) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "host-app" }));
    const nested = path.join(dir, "superwall");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "package.json"), JSON.stringify({ name: "host-app-paywalls" }));
    install(nested, "3.1.0");
  });
  const nested = path.join(root, "superwall");

  assert.equal(resolveFrameworkDir(nested), path.join(nested, "node_modules/superwall"));
  assert.equal(frameworkVersion(nested), "3.1.0");
});

test("a legacy host-root install still resolves when nothing is nested", () => {
  const root = layout((dir) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "host-app" }));
    fs.mkdirSync(path.join(dir, "superwall"), { recursive: true });
    install(dir, "1.9.0");
  });

  assert.equal(resolveFrameworkDir(root), path.join(root, "node_modules/superwall"));
  assert.equal(frameworkVersion(root), "1.9.0");
});

test("a dedicated repo — the project IS the root — resolves its own install", () => {
  const root = layout((dir) => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "paywalls", dependencies: { superwall: "^2.0.0" } }),
    );
    install(dir);
  });

  assert.equal(resolveFrameworkDir(root), path.join(root, "node_modules/superwall"));
});

test("the nested install wins over a host-root one", () => {
  const root = layout((dir) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "host-app" }));
    install(dir, "1.0.0");
    const nested = path.join(dir, "superwall");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "package.json"), JSON.stringify({ name: "paywalls" }));
    install(nested, "4.0.0");
  });

  assert.equal(frameworkVersion(root), "4.0.0");
});

test("a superwall/ directory with no install of its own falls back to the host root", () => {
  const root = layout((dir) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "host-app" }));
    install(dir, "1.5.0");
    fs.mkdirSync(path.join(dir, "superwall"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "superwall/package.json"),
      JSON.stringify({ name: "paywalls" }),
    );
  });

  assert.equal(frameworkVersion(root), "1.5.0");
});
