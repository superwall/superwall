import * as fs from "node:fs";
import * as path from "node:path";
import { isRecord } from "@/core/json";
import { parseSources, readLock, writeSources } from "@/core/paywalls/project/lock";

const LEGACY_FILE = path.join(".superwall", "source.json");

function readLegacyBases(superwallDir: string): Record<string, string> {
  const file = path.join(superwallDir, LEGACY_FILE);
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Can't read ${file} (${reason}) — fix or delete it, then push again.`);
  }
  if (!isRecord(parsed) || !isRecord(parsed.repos)) {
    throw new Error(`${file} isn't a source sync record — fix or delete it, then push again.`);
  }
  return parseSources(parsed.repos);
}

export function readSourceBase(superwallDir: string, repo: string): string | undefined {
  return readLock(superwallDir).sources?.[repo] ?? readLegacyBases(superwallDir)[repo];
}

export function writeSourceBase(superwallDir: string, repo: string, commitSha: string): void {
  const legacy = readLegacyBases(superwallDir);
  writeSources(superwallDir, { ...legacy, ...readLock(superwallDir).sources, [repo]: commitSha });
  fs.rmSync(path.join(superwallDir, LEGACY_FILE), { force: true });
}
