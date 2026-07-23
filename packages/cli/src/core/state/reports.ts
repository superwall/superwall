import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Saved so a later action (e.g. implement) can read what an earlier one (e.g. review) found.
function dir(appPath: string): string {
  return join(appPath, ".superwall");
}

function path(appPath: string, id: string): string {
  return join(dir(appPath), `${id}.md`);
}

export function saveReport(appPath: string, id: string, text: string): void {
  try {
    mkdirSync(dir(appPath), { recursive: true });
    writeFileSync(path(appPath, id), text, "utf8");
  } catch {
    /* non-fatal */
  }
}

export function loadReport(appPath: string, id: string): string | undefined {
  try {
    const p = path(appPath, id);
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  } catch {
    return undefined;
  }
}
