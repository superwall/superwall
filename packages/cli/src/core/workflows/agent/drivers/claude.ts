import { toolsForCapabilities } from "./capabilities";
import { emitAssistantEvents } from "./events";
import { isUsageLimitText } from "./limits";
import { onPath, readVersion, spawnStream } from "./spawn";
import type { AgentDriver, AgentResult, AgentRunOptions, DriverInfo } from "./types";

const BIN = "claude";

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
          emitAssistantEvents(msg.message, opts.onEvent);
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
