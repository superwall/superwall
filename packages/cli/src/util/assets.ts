import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
let root: string | undefined;

/** The package root: nearest ancestor with a package.json (repo in dev, install dir in prod). */
function packageRoot(): string {
  if (root) return root;
  let dir = moduleDir;
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (root = dir);
}

/** Locate a directory shipped with the package. */
export function packagedDir(name: "skills" | "prompts"): string {
  return join(packageRoot(), name) + "/";
}
