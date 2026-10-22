import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEnv } from "@/environment";

export const AGENT_SKILLS_DIR = (): string =>
  process.env.SUPERWALL_AGENT_SKILLS_DIR ?? join(homedir(), ".agents", "skills");

export const SUPERWALL_HOME = (): string => resolveEnv("SUPERWALL_HOME") ?? join(homedir(), ".superwall");

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

let root: string | undefined;

function resolvePackageRoot(): string {
  if (root) return root;
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (root = dir);
}

export function packagedDir(name: "skills" | "prompts"): string {
  return join(resolvePackageRoot(), name === "skills" ? "dist/skills" : name) + "/";
}
