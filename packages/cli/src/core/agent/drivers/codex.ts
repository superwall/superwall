import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import type { AgentDriver, AgentEvent, AgentResult, AgentRunOptions, DriverInfo } from "./types";
import { onPath, readVersion, spawnStream } from "./spawn";
import { isUsageLimitText } from "./limits";

const BIN = "codex";

// Codex's event schema shifts between versions; pull text/tool info defensively.
function normalizeCodexEvent(
  msg: Record<string, unknown>,
  onEvent?: (e: AgentEvent) => void,
): void {
  if (!onEvent) return;
  const item = (msg.item ?? null) as Record<string, unknown> | null;
  const inner = (msg.msg ?? null) as Record<string, unknown> | null;
  const node = inner ?? item ?? msg;
  const t = String(node.type ?? msg.type ?? "");

  if (t.includes("agent_message") || t.includes("assistant")) {
    const text = (node.message ?? node.text ?? node.delta) as string | undefined;
    if (typeof text === "string" && text.trim()) {
      const status = text.match(/\[STATUS\]\s*(.+?)\s*$/m)?.[1];
      if (status) onEvent({ type: "status", text: status.trim() });
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

    let ok = false;
    let usageLimited = false;
    const { code } = await spawnStream({
      bin: BIN,
      args,
      cwd: opts.cwd,
      signal: opts.signal,
      onStdoutLine: (line) => {
        if (isUsageLimitText(line)) usageLimited = true;
        try {
          normalizeCodexEvent(JSON.parse(line), opts.onEvent);
        } catch {
          /* ignore */
        }
      },
      onStderrLine: (line) => {
        if (isUsageLimitText(line)) usageLimited = true;
      },
    });
    ok = code === 0;

    let finalText: string | undefined;
    try {
      finalText = (await readFile(lastMsgFile, "utf8")).trim() || undefined;
    } catch {
      /* ignore */
    } finally {
      await rm(lastMsgFile, { force: true }).catch(() => {});
    }

    if (!ok)
      opts.onEvent?.({
        type: "error",
        message: `codex exited with code ${code}`,
      });
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
