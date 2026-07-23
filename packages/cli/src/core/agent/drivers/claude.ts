import { basename } from "node:path";
import type { AgentDriver, AgentEvent, AgentResult, AgentRunOptions, DriverInfo } from "./types";
import { onPath, readVersion, spawnStream } from "./spawn";
import { isUsageLimitText } from "./limits";
import { toolsForCapabilities } from "./capabilities";

const BIN = "claude";

function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.file_path === "string") return `${name} ${basename(i.file_path)}`;
  if (typeof i.command === "string") return `${name}: ${String(i.command).slice(0, 60)}`;
  if (typeof i.pattern === "string") return `${name} ${i.pattern}`;
  return name;
}

function extractStatus(text: string): string | undefined {
  const m = text.match(/\[STATUS\]\s*(.+?)\s*$/m);
  return m?.[1]?.trim();
}

function emitAssistant(message: unknown, onEvent?: (e: AgentEvent) => void): void {
  if (!onEvent) return;
  const content = (message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      const status = extractStatus(block.text);
      if (status) onEvent({ type: "status", text: status });
      else if (block.text.trim()) onEvent({ type: "text", text: block.text.trim() });
    } else if (block?.type === "tool_use" && typeof block.name === "string") {
      onEvent({
        type: "tool",
        name: block.name,
        summary: toolSummary(block.name, block.input),
      });
    }
  }
}

export const claudeDriver: AgentDriver = {
  id: "claude",
  displayName: "Claude Code",

  async detect(): Promise<DriverInfo | null> {
    if (!(await onPath(BIN))) return null;
    return {
      id: "claude",
      displayName: "Claude Code",
      bin: BIN,
      version: await readVersion(BIN),
    };
  },

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const args = buildClaudeArgs(opts);

    let finalText: string | undefined;
    let ok = false;
    let usageLimited = false;

    const { code } = await spawnStream({
      bin: BIN,
      args,
      cwd: opts.cwd,
      signal: opts.signal,
      onStdoutLine: (line) => {
        if (isUsageLimitText(line)) usageLimited = true;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.type === "assistant") {
          emitAssistant((msg as { message?: unknown }).message, opts.onEvent);
        } else if (msg.type === "result") {
          if (typeof msg.result === "string") finalText = msg.result;
          ok = msg.subtype === "success" && msg.is_error !== true;
        }
      },
      onStderrLine: (line) => {
        if (isUsageLimitText(line)) usageLimited = true;
      },
    });

    if (code !== 0 && !ok) {
      opts.onEvent?.({
        type: "error",
        message: `claude exited with code ${code}`,
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

export function buildClaudeArgs(opts: AgentRunOptions): string[] {
  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    opts.capabilities.filesystem === "read" ? "plan" : "acceptEdits",
    "--add-dir",
    opts.cwd,
    "--allowedTools",
    toolsForCapabilities(opts.capabilities).join(","),
  ];
  if (opts.systemAppend) args.push("--append-system-prompt", opts.systemAppend);
  return args;
}
