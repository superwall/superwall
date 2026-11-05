import { projectDir, workspace } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces logs",
  summary: "Show a version's build log",
  details: "The last 128 KiB, once the build has finished. The latest version by default.",
  args: {
    version: { describe: "The version id (default: the latest)" },
  },
  flags: {
    dir: projectDir,
    workspace,
    org: { type: "string", value: "id", describe: "The organization of a --workspace slug" },
  },
  examples: [
    ["workspaces logs", "The latest version's build log"],
    ["workspaces logs 7", "Version 7's"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceLogs } = await import("@/core/workspaces/status");
    await runWorkspaceLogs(ctx, { version: args.version, ...flags });
  },
});
