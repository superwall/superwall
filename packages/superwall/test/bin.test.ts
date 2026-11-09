// @vitest-environment node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const BIN = fileURLToPath(new URL("../bin/superwall.js", import.meta.url));
const BROKEN = JSON.stringify({ extends: "missing-pkg/tsconfig" });

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
});
