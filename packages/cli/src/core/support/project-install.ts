import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { allDeps, readPackageJson } from "@/core/codebase/package";
import { parseJson, textField } from "@/core/json";
import { selectLockfileManagers } from "@/core/paywalls/project/setup";

export type ProjectInstall = {
  version: string | undefined;
  manifest: string;
  update: string;
};

function selectInstallDir(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", "superwall", "package.json"))) return dir;
    if (dir === dirname(dir)) return undefined;
  }
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

export function selectProjectInstall(
  dir: string = process.cwd(),
  tag = "latest",
): ProjectInstall | undefined {
  const cwd = realpathSync(dir);
  for (const anchor of [join(cwd, "superwall", "package.json"), join(cwd, "package.json")]) {
    const installDir = selectInstallDir(dirname(anchor));
    if (!installDir) continue;
    const packageJson = join(installDir, "node_modules", "superwall", "package.json");
    const searched = selectDirsBetween(dirname(anchor), installDir);
    const projectDir = searched.find(dependsOnSuperwall) ?? installDir;
    const where = relative(cwd, projectDir);
    const install = `${resolveInstallCommand([...selectDirsBetween(projectDir, installDir), cwd])} superwall@${tag}`;
    return {
      version: textField(parseJson(readFileSync(packageJson, "utf8")), "version"),
      manifest: join(where, "package.json"),
      update: where ? `cd ${where} && ${install}` : install,
    };
  }
  return undefined;
}
