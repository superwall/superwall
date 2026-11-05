import { workspace } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces pull",
  summary: "Bring teammates' pushes into this project, merged with your edits",
  args: {
    dir: { describe: "The workspace project, or with --workspace an empty folder to fill (default: cwd)" },
  },
  flags: {
    workspace,
    org: { type: "string", value: "id", describe: "The organization of a --workspace slug" },
    theirs: { type: "boolean", describe: "Where you and the source repo both changed a file, take the source repo's version" },
  },
  examples: [
    ["workspaces pull", "Merge what teammates pushed into this project"],
    ["workspaces pull --theirs", "Take the source repo's version of files you both changed"],
    ["workspaces pull churn-copilot --workspace 42", "Get workspace 42's source into a new folder"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspacePull } = await import("@/core/workspaces/pull");
    await runWorkspacePull(ctx, { dir: args.dir, ...flags });
  },
});
