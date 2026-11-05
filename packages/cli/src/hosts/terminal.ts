import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { superwallApi } from "@/core/api/client";
import { useAscRefresh } from "@/core/app-store-connect/api/spec";
import { useStores } from "@/core/state/store";
import { maybeShowTelemetryNotice, track } from "@/core/support/telemetry";
import {
  isGlobalInstall,
  maybeNotifyUpdate,
  printAutoUpdate,
  recordAutoUpdate,
  refreshUpdateCheck,
  selectAutoUpdate,
} from "@/core/support/upgrade";
import { isNonInteractive } from "@/environment";
import { useHost, type Host, type Writable } from "@/program/host";
import type { OutputMode } from "@/program/output";
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

export function startAutoUpdate(
  version: string,
  spawn: typeof nodeSpawn = nodeSpawn,
  isGlobal: () => boolean = isGlobalInstall,
): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  recordAutoUpdate(version);
  if (!isGlobal()) return false;
  try {
    const child = spawn(process.execPath, [entry, "upgrade", "--json"], {
      cwd: tmpdir(),
      detached: true,
      stdio: "ignore",
      env: { ...process.env, SW_AUTO_UPDATE: version },
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function finishTerminal(
  stdout: Writable,
  mode: OutputMode,
  command: string,
  update: boolean,
  start: (version: string) => boolean = startAutoUpdate,
): void {
  refreshUpdateCheck();
  if (command === "upgrade") return;
  const version = update ? selectAutoUpdate() : null;
  if (version && start(version)) {
    if (mode !== "json") printAutoUpdate(stdout, version);
    return;
  }
  if (mode !== "json") maybeNotifyUpdate(stdout);
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
  finishing: (stdout, mode, command, update) => finishTerminal(stdout, mode, command, update),
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
