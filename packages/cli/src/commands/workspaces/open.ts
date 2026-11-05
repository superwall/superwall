import { app, projectDir, workspace } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces open",
  summary: "Open a workspace in the dashboard",
  args: {
    entrypoint: { describe: "An entrypoint to open inside an app, with --app" },
  },
  flags: {
    app: { ...app, describe: "The app to open the entrypoint in" },
    dir: projectDir,
    workspace,
    org: { type: "string", value: "id", describe: "The organization of a --workspace slug" },
    open: { type: "boolean", default: true, describe: "Open your browser at a terminal (--no-open to only print the link)" },
  },
  examples: [
    ["workspaces open", "This project's workspace"],
    ["workspaces open panel --app 5678", "One entrypoint, inside an app"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceOpen } = await import("@/core/workspaces/install");
    await runWorkspaceOpen(ctx, { entrypoint: args.entrypoint, ...flags });
  },
});
