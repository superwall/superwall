import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces push",
  summary: "Push this workspace's source and build it",
  details:
    "The first push creates the workspace from the manifest's name and records its id in superwall.workspace.json. Each push makes a version from the commit. Only you can see it until an admin approves it.",
  args: {
    dir: { describe: "The workspace project (default: cwd)" },
  },
  flags: {
    org: { type: "string", value: "id", describe: "The organization, on the first push" },
    m: { type: "string", value: "note", describe: "Why, recorded in the source commit" },
    overwriteSource: { type: "boolean", describe: "Replace what's in the source repo with this project" },
  },
  examples: [
    ["workspaces push", "Push and build this project"],
    ["workspaces push --org 1234 -m \"Add the cohort page\"", "The first push, with a note"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspacePush } = await import("@/core/workspaces/push");
    await runWorkspacePush(ctx, { dir: args.dir, ...flags });
  },
});
