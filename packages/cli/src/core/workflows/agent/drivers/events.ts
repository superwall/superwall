import { basename } from "node:path";
import type { AgentEvent } from "./types";

export function parseStatus(text: string): string | undefined {
  return text.match(/\[STATUS\]\s*(.+?)\s*$/m)?.[1]?.trim();
}

function summarizeTool(name: string, input: unknown): string {
  if (typeof input !== "object" || input === null) return name;
  if ("file_path" in input && typeof input.file_path === "string") {
    return `${name} ${basename(input.file_path)}`;
  }
  if ("command" in input && typeof input.command === "string") {
    return `${name}: ${input.command.slice(0, 60)}`;
  }
  if ("pattern" in input && typeof input.pattern === "string") return `${name} ${input.pattern}`;
  return name;
}

export function emitAssistantEvents(message: unknown, onEvent?: (e: AgentEvent) => void): void {
  if (!onEvent) return;
  if (typeof message !== "object" || message === null || !("content" in message)) return;
  const { content } = message;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      const status = parseStatus(block.text);
      if (status) onEvent({ type: "status", text: status });
      else if (block.text.trim()) onEvent({ type: "text", text: block.text.trim() });
    } else if (block?.type === "tool_use" && typeof block.name === "string") {
      onEvent({
        type: "tool",
        name: block.name,
        summary: summarizeTool(block.name, block.input),
      });
    }
  }
}
