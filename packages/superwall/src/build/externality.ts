import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const inside = (parent: string, file: string): boolean => {
  const relative = path.relative(parent, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const realpath = (file: string): string => {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
};

const packageRootOf = (file: string): string | undefined => {
  let dir = path.dirname(file);
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

const FRAMEWORK_STACK = ["@superwall/runtime", "@superwall/protocol"];

const frameworkTrees = (): string[] => {
  const roots = new Set<string>();
  let base = realpath(fileURLToPath(new URL("../../", import.meta.url)));
  roots.add(base);
  for (const specifier of FRAMEWORK_STACK) {
    try {
      const entry = realpath(createRequire(path.join(base, "package.json")).resolve(specifier));
      const root = packageRootOf(entry);
      if (!root) break;
      roots.add(root);
      base = root;
    } catch {
      break;
    }
  }
  return [...roots];
};

let trees: string[] | undefined;

export const externalSources = (moduleIds: Iterable<string>, superwallDir: string): string[] => {
  trees ??= frameworkTrees();
  const external = new Set<string>();

  for (const moduleId of moduleIds) {
    if (moduleId.startsWith("\0")) continue;
    const file = moduleId.split("?")[0] ?? moduleId;
    if (!path.isAbsolute(file)) continue;
    if (file.split(path.sep).includes("node_modules")) continue;
    if (inside(superwallDir, file)) continue;

    const real = realpath(file);
    if (real.split(path.sep).includes("node_modules")) continue;
    if (inside(superwallDir, real)) continue;
    if (trees.some((tree) => inside(tree, file) || inside(tree, real))) continue;

    external.add(path.relative(superwallDir, file).split(path.sep).join("/"));
  }
  return [...external].toSorted();
};
