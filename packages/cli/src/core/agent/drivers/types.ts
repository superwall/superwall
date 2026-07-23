export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary?: string }
  | { type: "status"; text: string }
  | { type: "error"; message: string };

export interface AgentCapabilities {
  filesystem: "read" | "write";
  network: boolean;
  shell: "none" | "read-only" | "unrestricted";
}

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  systemAppend?: string;
  capabilities: AgentCapabilities;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentResult {
  finalText?: string;
  ok: boolean;
  failureReason?: "usage-limit";
}

export interface DriverInfo {
  id: AgentDriverId;
  displayName: string;
  bin: string;
  version?: string;
}

export type AgentDriverId = "claude" | "codex" | "superwall";

export interface AgentDriver {
  id: AgentDriverId;
  displayName: string;
  detect(): Promise<DriverInfo | null>;
  run(options: AgentRunOptions): Promise<AgentResult>;
}
