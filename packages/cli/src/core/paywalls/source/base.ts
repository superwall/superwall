import * as fs from "node:fs";
import * as path from "node:path";

const BASE_FILE = path.join(".superwall", "source.json");

interface BaseRecord {
  version: 1;
  repos: Record<string, string>;
}

function read(superwallDir: string): BaseRecord {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(superwallDir, BASE_FILE), "utf8"),
    ) as unknown;
    if (typeof parsed === "object" && parsed !== null && "repos" in parsed) {
      const repos = (parsed as { repos: unknown }).repos;
      if (typeof repos === "object" && repos !== null) {
        const entries = Object.entries(repos).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && /^[0-9a-f]{40}$/.test(entry[1]),
        );
        return { version: 1, repos: Object.fromEntries(entries) };
      }
    }
  } catch {
    // Missing or unreadable: no base is known, which is the first-push case.
  }
  return { version: 1, repos: {} };
}

export function readSourceBase(superwallDir: string, repo: string): string | undefined {
  return read(superwallDir).repos[repo];
}

export function writeSourceBase(superwallDir: string, repo: string, commitSha: string): void {
  const record = read(superwallDir);
  record.repos[repo] = commitSha;
  const file = path.join(superwallDir, BASE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}
