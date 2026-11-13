// @vitest-environment node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const BIN = fileURLToPath(new URL("../bin/superwall.js", import.meta.url));
const BROKEN = JSON.stringify({ extends: "missing-pkg/tsconfig" });
const SELF_VERSION: string = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;
const LOCAL_BIN =
  'process.stdout.write(JSON.stringify({ ran: "local", args: process.argv.slice(2) }));\n';

const pinned = (version: string | undefined, extra: Record<string, string> = {}) => ({
  "superwall/package.json": JSON.stringify({
    name: "myapp-superwall",
    dependencies: { superwall: version ?? "*" },
  }),
  "superwall/node_modules/superwall/package.json": JSON.stringify({
    name: "superwall",
    type: "module",
    version,
  }),
  "superwall/node_modules/superwall/bin/superwall.js": LOCAL_BIN,
  ...extra,
});

const dirs: string[] = [];

const scaffold = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-bin-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
};

const run = (cwd: string, args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
  });

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("superwall bin", () => {
  describe("in an app whose tsconfig extends an uninstalled package", () => {
    const app = () =>
      scaffold({
        "package.json": JSON.stringify({ name: "myapp" }),
        "tsconfig.json": JSON.stringify({ extends: "expo/tsconfig.base" }),
      });

    it("prints help", () => {
      const result = run(app(), ["--help"]);
      expect(result.stderr).not.toContain("not found");
      expect(result.status).toBe(0);
    });

    it("creates superwall/ without reading the app's tsconfig", () => {
      const dir = app();
      const result = run(dir, ["create", "--yes", "--no-connect", "--no-install"]);
      expect(result.stderr).not.toContain("expo/tsconfig.base");
      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(dir, "superwall", "package.json"))).toBe(true);
    });
  });

  it("warns and carries on when superwall/tsconfig.json is broken", () => {
    const dir = scaffold({
      "package.json": JSON.stringify({ name: "myapp" }),
      "superwall/package.json": JSON.stringify({ name: "myapp-superwall" }),
      "superwall/tsconfig.json": BROKEN,
    });
    const result = run(dir, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      `Couldn't read ${path.join("superwall", "tsconfig.json")} (File 'missing-pkg/tsconfig' not found.) — loading TypeScript without it.`,
    );
  });

  it("warns and carries on inside a superwall project with a broken tsconfig", () => {
    const dir = scaffold({
      "package.json": JSON.stringify({ name: "myapp-superwall", dependencies: { superwall: "*" } }),
      "tsconfig.json": BROKEN,
    });
    const result = run(dir, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "Couldn't read tsconfig.json (File 'missing-pkg/tsconfig' not found.) — loading TypeScript without it.",
    );
  });

  it("ignores the cwd's tsconfig when the cwd doesn't depend on superwall", () => {
    const dir = scaffold({
      "package.json": JSON.stringify({ name: "myapp", dependencies: { react: "*" } }),
      "tsconfig.json": BROKEN,
    });
    const result = run(dir, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("Couldn't read");
  });

  describe("in a project that pins its own superwall", () => {
    it("names the older pinned version on stderr with the update command, then runs it", () => {
      const result = run(scaffold(pinned("2.0.0")), ["pull", "--json"]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe(
        `Running superwall 2.0.0 pinned by ${path.join("superwall", "package.json")}, not ${SELF_VERSION}. Update it: cd superwall && npm i superwall@latest\n`,
      );
      expect(JSON.parse(result.stdout)).toEqual({ ran: "local", args: ["pull", "--json"] });
    });

    it.each([
      ["pnpm-lock.yaml", "pnpm add"],
      ["bun.lock", "bun add"],
      ["yarn.lock", "yarn add"],
    ])("uses the package manager of the project's %s", (lockfile, command) => {
      const result = run(scaffold(pinned("2.0.0", { [`superwall/${lockfile}`]: "" })), [
        "--version",
      ]);
      expect(result.stderr).toContain(`Update it: cd superwall && ${command} superwall@latest`);
    });

    it("finds the lockfile at the repo root when the project has none", () => {
      const result = run(scaffold(pinned("2.0.0", { "pnpm-lock.yaml": "" })), ["--version"]);
      expect(result.stderr).toContain("Update it: cd superwall && pnpm add superwall@latest");
    });

    it("leaves out the cd when the cwd is the project", () => {
      const dir = scaffold(pinned("2.0.0"));
      const result = run(path.join(dir, "superwall"), ["--version"]);
      expect(result.stderr).toBe(
        `Running superwall 2.0.0 pinned by package.json, not ${SELF_VERSION}. Update it: npm i superwall@latest\n`,
      );
    });

    it("names the project, not pnpm's store folder, when pnpm installed the pin", () => {
      const store = "superwall/node_modules/.pnpm/superwall@2.0.0/node_modules/superwall";
      const dir = scaffold({
        "superwall/package.json": JSON.stringify({
          name: "myapp-superwall",
          dependencies: { superwall: "2.0.0" },
        }),
        "superwall/pnpm-lock.yaml": "",
        [`${store}/package.json`]: JSON.stringify({
          name: "superwall",
          type: "module",
          version: "2.0.0",
        }),
        [`${store}/bin/superwall.js`]: LOCAL_BIN,
      });
      fs.symlinkSync(
        path.join(dir, store),
        path.join(dir, "superwall", "node_modules", "superwall"),
      );
      const result = run(dir, ["--version"]);
      expect(result.stderr).toBe(
        `Running superwall 2.0.0 pinned by ${path.join("superwall", "package.json")}, not ${SELF_VERSION}. Update it: cd superwall && pnpm add superwall@latest\n`,
      );
    });

    it("names the workspace that pins it when the copy is hoisted to the repo root", () => {
      const dir = scaffold({
        "package.json": JSON.stringify({ name: "myapp", workspaces: ["superwall"] }),
        "package-lock.json": "",
        "superwall/package.json": JSON.stringify({
          name: "myapp-superwall",
          dependencies: { superwall: "2.0.0" },
        }),
        "node_modules/superwall/package.json": JSON.stringify({
          name: "superwall",
          type: "module",
          version: "2.0.0",
        }),
        "node_modules/superwall/bin/superwall.js": LOCAL_BIN,
      });
      const result = run(dir, ["--version"]);
      expect(result.stderr).toBe(
        `Running superwall 2.0.0 pinned by ${path.join("superwall", "package.json")}, not ${SELF_VERSION}. Update it: cd superwall && npm i superwall@latest\n`,
      );
      expect(JSON.parse(result.stdout).ran).toBe("local");
    });

    it("names the root when only the root declares the hoisted pin", () => {
      const dir = scaffold({
        "package.json": JSON.stringify({ name: "myapp", dependencies: { superwall: "2.0.0" } }),
        "bun.lock": "",
        "superwall/package.json": JSON.stringify({ name: "myapp-superwall" }),
        "node_modules/superwall/package.json": JSON.stringify({
          name: "superwall",
          type: "module",
          version: "2.0.0",
        }),
        "node_modules/superwall/bin/superwall.js": LOCAL_BIN,
      });
      const result = run(dir, ["--version"]);
      expect(result.stderr).toBe(
        `Running superwall 2.0.0 pinned by package.json, not ${SELF_VERSION}. Update it: bun add superwall@latest\n`,
      );
    });

    it("says so when the pinned copy has no readable version", () => {
      const result = run(scaffold(pinned(undefined)), ["--version"]);
      expect(result.stderr).toContain("Running superwall of unknown version pinned by");
      expect(JSON.parse(result.stdout).ran).toBe("local");
    });

    it("names a prerelease of the same version as older", () => {
      const result = run(scaffold(pinned(`${SELF_VERSION}-beta.1`)), ["--version"]);
      expect(result.stderr).toContain(`Running superwall ${SELF_VERSION}-beta.1 pinned by`);
    });

    it.each([SELF_VERSION, "99.0.0", "99.0.0-beta.1"])(
      "prints nothing when the pinned copy is %s",
      (version) => {
        const result = run(scaffold(pinned(version)), ["--version"]);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout).ran).toBe("local");
      },
    );
  });
});
