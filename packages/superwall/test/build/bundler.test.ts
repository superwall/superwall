// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import { describe, expect, it } from "vitest";
import {
  assertBundlerBuilds,
  pinnedRollupVersion,
  viteRollupVersion,
} from "../../src/build/bundler";

describe("bundler guard", () => {
  it("refuses the Rollup versions whose tree-shaking never finishes", () => {
    for (const version of ["4.64.0", "4.64.1"]) {
      expect(() => assertBundlerBuilds(version, () => "4.63.6")).toThrow(
        `Rollup ${version} never finishes building a paywall`,
      );
    }
  });

  it("names the pinned version in the fix", () => {
    expect(() => assertBundlerBuilds("4.64.1", () => "4.63.6")).toThrow(
      '"overrides": { "rollup": "4.63.6" }',
    );
  });

  it("builds on every other version, and when the version cannot be read", () => {
    for (const version of ["4.62.2", "4.63.6", "4.64.2", "5.0.0", undefined]) {
      expect(() => assertBundlerBuilds(version, () => "4.63.6")).not.toThrow();
    }
  });

  it("reads the pin from superwall's own package.json", () => {
    const own = JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(pinnedRollupVersion()).toBe(own.dependencies.rollup);
    const bare = `${fs.mkdtempSync(`${os.tmpdir()}/sw-pin-`)}/package.json`;
    fs.writeFileSync(bare, JSON.stringify({ dependencies: {} }));
    expect(() => pinnedRollupVersion(bare)).toThrow("does not pin rollup");
  });

  it("reads the Rollup that Vite itself resolves", () => {
    expect(viteRollupVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(viteRollupVersion("file:///nowhere/at/all.js")).toBeUndefined();
  });
});
