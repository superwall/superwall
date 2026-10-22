import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { superwallApi } from "@/core/api/client";
import { useAscRefresh } from "@/core/app-store-connect/api/spec";
import { useStores } from "@/core/state/store";
import { maybeShowTelemetryNotice, track } from "@/core/support/telemetry";
import { maybeNotifyUpdate, refreshUpdateCheck } from "@/core/support/upgrade";
import { isNonInteractive } from "@/environment";
import { useHost, type Host } from "@/program/host";
import { selectRenderer } from "@/ui/select";
import { fileStore } from "./files";
import { detectApp, readLockRef } from "./local-project";
import { expandHome, SUPERWALL_HOME } from "./paths";

export function startAscRefresh(spawn: typeof nodeSpawn = nodeSpawn): void {
  if (process.env.SW_ASC_REFRESH === "1") return;
  const entry = process.argv[1];
  if (!entry) return;
  try {
    const child = spawn(process.execPath, [entry, "asc", "docs", "--refresh", "--quiet"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, SW_ASC_REFRESH: "1" },
    });
    child.unref();
  } catch {
    return;
  }
}

export const terminalHost: Host = {
  api: superwallApi,
  renderer: (mode) => selectRenderer({ mode }),
  stdout: process.stdout,
  get nonInteractive() {
    return isNonInteractive();
  },
  installDir: (flag) => resolve(flag ?? process.cwd()),
  readInput: (path) => readFileSync(path === "-" ? 0 : expandHome(path), "utf8"),
  detectApp,
  readLockRef,
  track,
  starting: (ui, mode) => {
    if (mode === "rich") maybeShowTelemetryNotice(ui);
  },
  finishing: (stdout, mode, command) => {
    if (mode === "json") return;
    refreshUpdateCheck();
    if (command !== "upgrade") maybeNotifyUpdate(stdout);
  },
  fail: () => {
    process.exitCode = 1;
  },
  waitForPaint: true,
};

export function installTerminal(): void {
  const files = fileStore(SUPERWALL_HOME);
  useStores({ cache: files, state: files });
  useAscRefresh(() => startAscRefresh());
  useHost(terminalHost);
}
