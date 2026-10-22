import * as fs from "node:fs";
import * as path from "node:path";
import { detectExisting } from "@/core/codebase/existing";
import { scanProject } from "@/core/codebase/scan";
import type { LocalApp, LockRef } from "@/program/host";

export async function detectApp(installDir: string): Promise<LocalApp> {
  const scan = await scanProject(installDir).catch(() => null);
  const detected = scan?.apps[0];
  if (!detected) return {};
  return { apiKey: detectExisting(detected).apiKey, name: detected.name };
}

export function readLockRef(installDir: string): LockRef | undefined {
  for (const file of [
    path.join(installDir, "superwall.lock"),
    path.join(installDir, "superwall", "superwall.lock"),
  ]) {
    let parsed: {
      apps?: Record<string, unknown>;
      paywalls?: Record<string, Record<string, unknown>>;
      funnels?: Record<string, Record<string, unknown>>;
    };
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const appId = Object.values(parsed.apps ?? {}).find((id): id is string => typeof id === "string");
    let paywallId: string | undefined;
    for (const entry of Object.values({ ...parsed.paywalls, ...parsed.funnels })) {
      if (typeof entry?.paywallId === "string") paywallId = entry.paywallId;
      for (const binding of Object.values(entry ?? {})) {
        if (typeof binding !== "object" || binding === null || !("paywallId" in binding)) continue;
        if (typeof binding.paywallId === "string") paywallId ??= binding.paywallId;
      }
      if (paywallId) break;
    }
    return { appId, paywallId };
  }
  return undefined;
}
