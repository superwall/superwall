import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";
import { formatSharedLock } from "@/core/paywalls/project/lock";

export interface SourceFile {
  path: string;
  content: Buffer;
}

export type CollectedFiles = { ok: true; files: SourceFile[] } | { ok: false; reason: string };

const HARD_EXCLUDES = [
  ".superwall/**",
  "**/node_modules/**",
  ".git/**",
  "**/.env*",
  "**/.DS_Store",
  "**/.npmrc",
  "**/.netrc",
  "**/*.pem",
  "**/*.p8",
  "**/*.p12",
  "**/*.key",
  "**/*.keystore",
  "**/*.jks",
  "**/google-services.json",
  "**/GoogleService-Info.plist",
];

const LOCK_FILE = "superwall.lock";

const SOURCE_LIMIT_BYTES = 250 * 1024 * 1024;

const LARGEST_SHOWN = 3;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function gitignoreExcludes(superwallDir: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(superwallDir, ".gitignore"), "utf8");
  } catch {
    return [];
  }

  const excludes: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const anchored = line.startsWith("/");
    const body = (anchored ? line.slice(1) : line).replace(/\/+$/, "");
    if (body === "") continue;
    const base = anchored || body.includes("/") ? body : `**/${body}`;
    excludes.push(base, `${base}/**`);
  }
  return excludes;
}

export async function collectSourceFiles(superwallDir: string): Promise<CollectedFiles> {
  const entries = await fg("**/*", {
    cwd: superwallDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [...HARD_EXCLUDES, ...gitignoreExcludes(superwallDir)],
  });

  if (entries.length === 0) {
    return { ok: false, reason: `No source files found in ${superwallDir}.` };
  }

  const sizes = entries.map((relative) => ({
    path: relative,
    bytes: fs.statSync(path.join(superwallDir, relative)).size,
  }));
  const total = sizes.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total > SOURCE_LIMIT_BYTES) {
    const largest = sizes
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, LARGEST_SHOWN)
      .map((entry) => `${entry.path} (${megabytes(entry.bytes)})`)
      .join(", ");
    return {
      ok: false,
      reason:
        `The source in ${superwallDir} is ${megabytes(total)}, over the ${SOURCE_LIMIT_BYTES / 1024 / 1024} MB limit. ` +
        `Largest: ${largest}. Add what doesn't belong to .gitignore, then push again.`,
    };
  }

  return {
    ok: true,
    files: entries.sort().map((relative) => ({
      path: relative,
      content:
        relative === LOCK_FILE
          ? Buffer.from(formatSharedLock(superwallDir))
          : fs.readFileSync(path.join(superwallDir, relative)),
    })),
  };
}
