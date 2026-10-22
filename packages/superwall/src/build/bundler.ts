import * as fs from "node:fs";
import { createRequire } from "node:module";

const HANGING_ROLLUP_VERSIONS = new Set(["4.64.0", "4.64.1"]);

const readVersion = (packageJson: string): string | undefined =>
  (JSON.parse(fs.readFileSync(packageJson, "utf8")) as { version?: string }).version;

export const viteRollupVersion = (from: string = import.meta.url): string | undefined => {
  try {
    const vite = createRequire(from).resolve("vite/package.json");
    return readVersion(createRequire(vite).resolve("rollup/package.json"));
  } catch {
    return undefined;
  }
};

export const pinnedRollupVersion = (
  own: URL | string = new URL("../../package.json", import.meta.url),
): string => {
  const parsed = JSON.parse(fs.readFileSync(own, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const pinned = parsed.dependencies?.rollup;
  if (pinned === undefined) throw new Error("superwall's package.json does not pin rollup.");
  return pinned;
};

export const assertBundlerBuilds = (
  version: string | undefined = viteRollupVersion(),
  pinned: () => string = pinnedRollupVersion,
): void => {
  if (version === undefined || !HANGING_ROLLUP_VERSIONS.has(version)) return;
  throw new Error(
    `Rollup ${version} never finishes building a paywall: its tree-shaking loops. ` +
      `Pin the version superwall ships with by adding "overrides": { "rollup": "${pinned()}" } ` +
      `to your package.json ("pnpm": { "overrides": { "rollup": "${pinned()}" } } on pnpm), then reinstall.`,
  );
};
