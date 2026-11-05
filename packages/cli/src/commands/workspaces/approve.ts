import { projectDir, workspace, yes } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces approve",
  summary: "Review what a version can do and make it live",
  details:
    "Admins only. Shows the version's manifest and how it differs from the live version, then asks. Without a terminal it needs --yes, and --accept-changes too when what the workspace can do changes.",
  args: {
    version: { describe: "The version id (default: the latest built that isn't live)" },
  },
  flags: {
    dir: projectDir,
    workspace,
    org: { type: "string", value: "id", describe: "The organization of a --workspace slug" },
    yes: { ...yes, describe: "Go ahead without asking, when nothing it can do changes" },
    acceptChanges: { type: "boolean", describe: "With --yes: also accept changes to what it can do" },
  },
  examples: [
    ["workspaces approve --workspace 42", "Review and approve the latest built version"],
    ["workspaces approve 7 --workspace 42 --json", "Print version 7's manifest and changes, approving nothing"],
    ["workspaces approve 7 --workspace 42 --yes --accept-changes", "Approve it without a terminal, having read them"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceApprove } = await import("@/core/workspaces/approve");
    await runWorkspaceApprove(ctx, { version: args.version, ...flags });
  },
});
