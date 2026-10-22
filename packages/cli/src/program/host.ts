import type { SuperwallApi } from "@/core/api/client";
import type { OutputMode } from "@/program/output";
import type { Renderer } from "@/ui/types";

export type Writable = Pick<NodeJS.WriteStream, "write">;

export interface LocalApp {
  apiKey?: string;
  name?: string;
}

export interface LockRef {
  appId?: string;
  paywallId?: string;
}

export interface Host {
  api: () => SuperwallApi;
  renderer: (mode: OutputMode) => Renderer;
  stdout: Writable;
  nonInteractive: boolean;
  installDir: (flag: string | undefined) => string;
  readInput: (path: string) => string;
  detectApp: (installDir: string) => Promise<LocalApp>;
  readLockRef: (installDir: string) => LockRef | undefined;
  track: (event: string, props: Record<string, unknown>) => void;
  starting: (ui: Renderer, mode: OutputMode) => void;
  finishing: (stdout: Writable, mode: OutputMode, command: string) => void;
  fail: () => void;
  waitForPaint: boolean;
}

let installed: Host | undefined;

export function useHost(host: Host): void {
  installed = host;
}

export function currentHost(): Host {
  if (!installed) throw new Error("No host is installed: the terminal or the MCP server installs one before a command runs.");
  return installed;
}

export function readInput(path: string): string {
  return currentHost().readInput(path);
}
