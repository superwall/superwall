import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { allDeps, readPackageJson } from "@/core/codebase/package";
import { parseJson, textField } from "@/core/json";
import { selectLockfileManagers } from "@/core/paywalls/project/setup";

export type ProjectInstall = {
  version: string | undefined;
  manifest: string;
  update: string;
};

function resolveInstallDir(packageJson: string): string {
  const marker = `${sep}node_modules${sep}`;
  const index = packageJson.indexOf(marker);
  return index === -1 ? dirname(packageJson) : packageJson.slice(0, index);
}

function selectDirsBetween(from: string, to: string): string[] {
  const dirs: string[] = [];
  for (let dir = from; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (dir === to || dir === dirname(dir)) return dirs;
  }
}

function dependsOnSuperwall(dir: string): boolean {
  return "superwall" in allDeps(readPackageJson(dir));
}

function resolveInstallCommand(dirs: readonly string[]): string {
  for (const dir of dirs) {
    const [manager] = selectLockfileManagers(dir);
    if (manager) return manager === "npm" ? "npm i" : `${manager} add`;
  }
  return "npm i";
}

export function selectProjectInstall(dir: string = process.cwd()): ProjectInstall | undefined {
  const cwd = realpathSync(dir);
  for (const anchor of [join(cwd, "superwall", "package.json"), join(cwd, "package.json")]) {
    let packageJson: string;
    try {
      packageJson = createRequire(anchor).resolve("superwall/package.json");
    } catch {
      continue;
    }
    const installDir = resolveInstallDir(packageJson);
    const searched = selectDirsBetween(dirname(anchor), installDir);
    const projectDir = searched.find(dependsOnSuperwall) ?? installDir;
    const where = relative(cwd, projectDir);
    const install = `${resolveInstallCommand([...selectDirsBetween(projectDir, installDir), cwd])} superwall@latest`;
    return {
      version: textField(parseJson(readFileSync(packageJson, "utf8")), "version"),
      manifest: join(where, "package.json"),
      update: where ? `cd ${where} && ${install}` : install,
    };
  }
  return undefined;
}
