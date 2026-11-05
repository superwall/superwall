import { projectDir, workspace } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces share",
  summary: "Ask an admin to review a version",
  details: "The latest built version by default. Until an admin approves it, only its author can see it.",
  args: {
    version: { describe: "The version id (default: the latest built)" },
  },
  flags: {
    dir: projectDir,
    workspace,
    org: { type: "string", value: "id", describe: "The organization of a --workspace slug" },
  },
  examples: [["workspaces share", "Ask for review of the latest built version"]],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceShare } = await import("@/core/workspaces/status");
    await runWorkspaceShare(ctx, { version: args.version, ...flags });
  },
});
