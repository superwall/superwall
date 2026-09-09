import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dirs: string[] = [];
let savedPath: string | undefined;

export function useBin(bins: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-bin-"));
  dirs.push(dir);
  for (const [name, script] of Object.entries(bins)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, script.startsWith("#!") ? script : `#!/bin/sh\n${script}\n`);
    fs.chmodSync(file, 0o755);
  }
  savedPath ??= process.env.PATH;
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
  return dir;
}

export function restoreBin(): void {
  if (savedPath !== undefined) process.env.PATH = savedPath;
  savedPath = undefined;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}
