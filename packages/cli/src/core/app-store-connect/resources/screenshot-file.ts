import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export interface ScreenshotFile {
  name: string;
  bytes: Uint8Array;
  checksum: string;
}

export function readScreenshotFile(path: string): ScreenshotFile {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: basename(path), bytes, checksum: createHash("md5").update(bytes).digest("hex") };
}
