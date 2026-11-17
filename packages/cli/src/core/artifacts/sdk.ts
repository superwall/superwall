import * as fs from "node:fs";
import * as path from "node:path";
import type { Renderer } from "@/ui/types";
import { rawFileUrl, releaseRefs } from "@/core/repo/download";
import { VENDORED_SDK } from "./project";

export const STARTER_DIR = "artifacts/starter";

const LATEST_TIMEOUT_MS = 1_500;

type FetchVersion = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

const SDK_MANIFEST = `${STARTER_DIR}/vendor/artifact-sdk/package.json`;

function versionOf(manifest: unknown): string | undefined {
  const version = (manifest as { version?: unknown } | null)?.version;
  return typeof version === "string" ? version : undefined;
}

export function vendoredVersion(root: string): string | undefined {
  try {
    return versionOf(JSON.parse(fs.readFileSync(path.join(root, VENDORED_SDK, "package.json"), "utf8")));
  } catch {
    return undefined;
  }
}

/**
 * The artifact SDK `superwall artifacts update` would install: the one at this
 * CLI's release tag (or `main` for an untagged build), so the "behind" warning
 * and the update agree.
 */
export async function latestVersion(fetchImpl: FetchVersion = fetch): Promise<string | undefined> {
  try {
    const signal = AbortSignal.timeout(LATEST_TIMEOUT_MS);
    for (const ref of releaseRefs()) {
      const response = await fetchImpl(rawFileUrl(ref, SDK_MANIFEST), { signal });
      if (response.ok) return versionOf(await response.json());
      if (response.status !== 404) return undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function compareIdentifiers(a: string, b: string): number {
  const [x, y] = [Number(a), Number(b)];
  const [xNumeric, yNumeric] = [/^\d+$/.test(a), /^\d+$/.test(b)];
  if (xNumeric && yNumeric) return x - y;
  if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = "", ...pre] = version.split("+")[0]!.split("-");
    return { core: core.split(".").map(Number), pre: pre.join("-").split(".").filter(Boolean) };
  };
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const [x, y] = [left.pre[index], right.pre[index]];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const difference = compareIdentifiers(x, y);
    if (difference !== 0) return difference;
  }
  return 0;
}

const isBehind = (current: string, latest: string): boolean => compareVersions(current, latest) < 0;

export async function warnIfSdkBehind(ui: Renderer, root: string, fetchImpl?: FetchVersion): Promise<void> {
  const current = vendoredVersion(root);
  if (current === undefined) {
    ui.warn("This artifact has no vendored SDK package. Run `superwall artifacts update` to add it.");
    return;
  }
  const latest = await latestVersion(fetchImpl);
  if (latest !== undefined && isBehind(current, latest)) {
    ui.warn(`Its artifact SDK is ${current}, and ${latest} is out. Run \`superwall artifacts update\` to get it.`);
  }
}
