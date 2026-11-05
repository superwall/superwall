import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces create",
  summary: "Start a workspace: a mini-app that adds to the Superwall dashboard",
  args: {
    dir: { describe: "Where to put it (default: my-workspace)" },
  },
  flags: {
    install: { type: "boolean", default: true, describe: "Install dependencies after downloading (--no-install to skip)" },
  },
  examples: [
    ["workspaces create", "Download the starter into my-workspace"],
    ["workspaces create churn-copilot", "Name the directory yourself"],
  ],
  auth: "none",
  json: false,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceCreate } = await import("@/core/workspaces/starter");
    await runWorkspaceCreate(ctx, { dir: args.dir, install: flags.install });
  },
});
