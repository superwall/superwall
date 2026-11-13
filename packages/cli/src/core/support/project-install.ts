import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { parseJson, textField } from "@/core/json";

export type ProjectInstall = {
  version: string | undefined;
  manifest: string;
  update: string;
};

const LOCKFILES: ReadonlyArray<readonly [file: string, install: string]> = [
  ["bun.lock", "bun add"],
  ["bun.lockb", "bun add"],
  ["pnpm-lock.yaml", "pnpm add"],
  ["yarn.lock", "yarn add"],
  ["package-lock.json", "npm i"],
];

function resolveProjectDir(packageJson: string): string {
  const marker = `${sep}node_modules${sep}`;
  const index = packageJson.indexOf(marker);
  return index === -1 ? dirname(packageJson) : packageJson.slice(0, index);
}

function resolveInstallCommand(projectDir: string, cwd: string): string {
  for (const dir of [projectDir, cwd]) {
    const found = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (found) return found[1];
  }
  return "npm i";
}

export function selectProjectInstall(cwd: string = process.cwd()): ProjectInstall | undefined {
  for (const anchor of [join(cwd, "superwall", "package.json"), join(cwd, "package.json")]) {
    let packageJson: string;
    try {
      packageJson = createRequire(anchor).resolve("superwall/package.json");
    } catch {
      continue;
    }
    const projectDir = resolveProjectDir(packageJson);
    const where = relative(realpathSync(cwd), projectDir);
    const install = `${resolveInstallCommand(projectDir, cwd)} superwall@latest`;
    return {
      version: textField(parseJson(readFileSync(packageJson, "utf8")), "version"),
      manifest: join(where, "package.json"),
      update: where ? `cd ${where} && ${install}` : install,
    };
  }
  return undefined;
}
