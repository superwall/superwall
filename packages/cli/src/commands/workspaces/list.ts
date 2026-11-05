import { projectDir } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces list",
  summary: "List an organization's workspaces",
  flags: {
    org: { type: "string", value: "id", describe: "The organization (default: this project's, or asks)" },
    dir: projectDir,
  },
  examples: [["workspaces list --org 1234", "Every workspace in organization 1234"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { flags }) {
    const { runWorkspaceList } = await import("@/core/workspaces/install");
    await runWorkspaceList(ctx, flags);
  },
});
