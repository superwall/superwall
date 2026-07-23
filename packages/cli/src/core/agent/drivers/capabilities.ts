import type { AgentCapabilities } from "./types";

export function toolsForCapabilities(capabilities: AgentCapabilities): string[] {
  const tools = ["Read", "Glob", "Grep"];
  if (capabilities.filesystem === "write") tools.push("Write", "Edit");
  if (capabilities.shell !== "none") tools.push("Bash");
  if (capabilities.network) tools.push("WebFetch", "WebSearch");
  return tools;
}
