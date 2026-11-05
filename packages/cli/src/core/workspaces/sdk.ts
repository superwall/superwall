import * as fs from "node:fs";
import * as path from "node:path";
import type { Renderer } from "@/ui/types";
import { PUBLIC_REF, PUBLIC_REPO } from "@/core/repo/download";
import { VENDORED_SDK } from "./project";

export const STARTER_DIR = "workspaces/starter";

const LATEST_TIMEOUT_MS = 1_500;

type FetchVersion = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const LATEST_URL = (): string =>
  `https://raw.githubusercontent.com/${PUBLIC_REPO}/${PUBLIC_REF}/${STARTER_DIR}/vendor/workspace-sdk/package.json`;

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

export async function latestVersion(fetchImpl: FetchVersion = fetch): Promise<string | undefined> {
  try {
    const response = await fetchImpl(LATEST_URL(), { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) });
    return response.ok ? versionOf(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

function isBehind(current: string, latest: string): boolean {
  const parts = (version: string) => version.split("-")[0]!.split(".").map(Number);
  const [a, b] = [parts(current), parts(latest)];
  for (let index = 0; index < 3; index += 1) {
    const [x = 0, y = 0] = [a[index], b[index]];
    if (x !== y) return x < y;
  }
  return false;
}

export async function warnIfSdkBehind(ui: Renderer, root: string, fetchImpl?: FetchVersion): Promise<void> {
  const current = vendoredVersion(root);
  if (current === undefined) {
    ui.warn("This workspace has no vendored SDK package. Run `superwall workspaces update` to add it.");
    return;
  }
  const latest = await latestVersion(fetchImpl);
  if (latest !== undefined && isBehind(current, latest)) {
    ui.warn(`Its workspace SDK is ${current}, and ${latest} is out. Run \`superwall workspaces update\` to get it.`);
  }
}
