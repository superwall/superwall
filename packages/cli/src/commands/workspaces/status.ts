import { projectDir, workspace } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces status",
  summary: "Show a workspace's state and its latest versions",
  flags: {
    dir: projectDir,
    workspace,
    org: { type: "string", value: "id", describe: "The organization of a --workspace slug" },
    all: { type: "boolean", describe: "List every version, not just the latest and the live one" },
  },
  examples: [
    ["workspaces status", "This project's workspace"],
    ["workspaces status --workspace 42", "Any workspace you can see"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { flags }) {
    const { runWorkspaceStatus } = await import("@/core/workspaces/status");
    await runWorkspaceStatus(ctx, flags);
  },
});
