import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "promote",
  summary: "Point production at a pushed version (the latest by default)",
  args: {
    dir: { describe: "Project directory (default: cwd)" },
  },
  flags: {
    id: { type: "list", value: "id", describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)" },
    platform: {
      type: "list",
      value: "platform",
      describe: "Limit to these platforms (repeatable, or comma-separated) - ios, android, web",
    },
    version: {
      type: "number",
      alias: "v",
      describe: "Pushed version number to promote (requires a single --id)",
    },
  },
  examples: [
    ["promote", "Make the latest pushed version of every paywall live"],
    ["promote --id plus-upgrade --version 3", "Roll one paywall back to version 3"],
  ],
  auth: "none",
  json: false,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, input) {
    const { runPromote } = await import("@/core/paywalls/promote");
    return runPromote(ctx, input);
  },
});
