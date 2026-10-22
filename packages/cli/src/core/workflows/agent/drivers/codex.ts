import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStatus } from "./events";
import { isUsageLimitText } from "./limits";
import { onPath, readVersion, spawnStream } from "./spawn";
import type { AgentDriver, AgentEvent, AgentResult, AgentRunOptions, DriverInfo } from "./types";

const BIN = "codex";

function emitCodexEvent(msg: Record<string, unknown>, onEvent?: (e: AgentEvent) => void): void {
  if (!onEvent) return;
  const item = (msg.item ?? null) as Record<string, unknown> | null;
  const inner = (msg.msg ?? null) as Record<string, unknown> | null;
  const node = inner ?? item ?? msg;
  const t = String(node.type ?? msg.type ?? "");

  if (t.includes("agent_message") || t.includes("assistant")) {
    const text = node.message ?? node.text ?? node.delta;
    if (typeof text === "string" && text.trim()) {
      const status = parseStatus(text);
      if (status) onEvent({ type: "status", text: status });
      else onEvent({ type: "text", text: text.trim() });
    }
  } else if (
    t.includes("command") ||
    t.includes("exec") ||
    t.includes("patch") ||
    t.includes("file")
  ) {
    const cmd = node.command;
    const summary = Array.isArray(cmd) ? cmd.join(" ").slice(0, 60) : undefined;
    onEvent({ type: "tool", name: "exec", summary });
  }
}

function parseCodexLine(line: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return parsed as Record<string, unknown>;
}

async function readLastMessage(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  } finally {
    await rm(file, { force: true }).catch(() => {});
  }
}

export const codexDriver: AgentDriver = {
  id: "codex",
  displayName: "Codex",

  async detect(): Promise<DriverInfo | null> {
    if (!(await onPath(BIN))) return null;
    return {
      id: "codex",
      displayName: "Codex",
      bin: BIN,
      version: await readVersion(BIN),
    };
  },

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const lastMsgFile = join(tmpdir(), `superwall-codex-${process.pid}-${Date.now()}.txt`);
    const args = buildCodexArgs(opts, lastMsgFile);

    let usageLimited = false;
    const { code } = await spawnStream({
      bin: BIN,
      args,
      cwd: opts.cwd,
      signal: opts.signal,
      onStdoutLine: (line) => {
        if (isUsageLimitText(line)) usageLimited = true;
        const event = parseCodexLine(line);
        if (event) emitCodexEvent(event, opts.onEvent);
      },
      onStderrLine: (line) => {
        if (isUsageLimitText(line)) usageLimited = true;
      },
    });
    const ok = code === 0;
    const finalText = await readLastMessage(lastMsgFile);
    if (!ok) {
      opts.onEvent?.({
        type: "error",
        message: `codex exited with code ${code}`,
      });
    }
    return {
      finalText,
      ok,
      failureReason:
        !ok && (usageLimited || isUsageLimitText(finalText)) ? "usage-limit" : undefined,
    };
  },
};

export function buildCodexArgs(opts: AgentRunOptions, lastMsgFile: string): string[] {
  const prompt = opts.systemAppend ? `${opts.systemAppend}\n\n---\n\n${opts.prompt}` : opts.prompt;
  const readOnly = opts.capabilities.filesystem === "read";
  const args = ["exec", prompt, "--json", "--sandbox", readOnly ? "read-only" : "workspace-write"];
  if (opts.capabilities.network) {
    args.push(
      "-c",
      `${readOnly ? "sandbox_read_only" : "sandbox_workspace_write"}.network_access=true`,
    );
  }
  args.push("-C", opts.cwd, "--skip-git-repo-check", "--output-last-message", lastMsgFile);
  return args;
}
