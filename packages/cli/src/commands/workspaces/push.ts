import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces push",
  summary: "Push this workspace's source and build it",
  details:
    "The first push creates the workspace from the manifest's name and records its id in superwall.workspace.json. Each push makes a version from the commit. Only you can see it until an admin approves it. When the source repo has commits this project doesn't, the push merges them, and your own copy runs them with your reads, so it asks first. Without a terminal it stops unless you pass --accept-merged-commits.",
  args: {
    dir: { describe: "The workspace project (default: cwd)" },
  },
  flags: {
    org: { type: "string", value: "id", describe: "The organization, on the first push" },
    m: { type: "string", value: "note", describe: "Why, recorded in the source commit" },
    overwriteSource: { type: "boolean", describe: "Replace what's in the source repo with this project" },
    acceptMergedCommits: { type: "boolean", describe: "Run commits this push merges from teammates in your copy, without asking" },
  },
  examples: [
    ["workspaces push", "Push and build this project"],
    ["workspaces push --org 1234 -m \"Add the cohort page\"", "The first push, with a note"],
    ["workspaces push --json --accept-merged-commits", "In a script, taking in teammates' commits"],
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
