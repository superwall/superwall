import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function dir(appPath: string): string {
  return join(appPath, ".superwall");
}

function path(appPath: string, id: string): string {
  return join(dir(appPath), `${id}.md`);
}

export function writeReport(appPath: string, id: string, text: string): void {
  try {
    mkdirSync(dir(appPath), { recursive: true });
    writeFileSync(path(appPath, id), text, "utf8");
  } catch {}
}

export function readReport(appPath: string, id: string): string | undefined {
  try {
    const file = path(appPath, id);
    if (!existsSync(file)) return undefined;
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
