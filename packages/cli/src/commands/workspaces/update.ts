import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces update",
  summary: "Refresh a workspace's vendored SDK from the public repo",
  args: {
    dir: { describe: "The workspace (default: cwd)" },
  },
  flags: {
    install: { type: "boolean", default: true, describe: "Update the lockfile after downloading (--no-install to skip)" },
    force: { type: "boolean", describe: "Replace a vendored SDK that's newer than the latest published one" },
  },
  examples: [["workspaces update", "Replace vendor/workspace-sdk with the latest and update the lockfile"]],
  auth: "none",
  json: false,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceUpdate } = await import("@/core/workspaces/starter");
    await runWorkspaceUpdate(ctx, { dir: args.dir, install: flags.install, force: flags.force });
  },
});
