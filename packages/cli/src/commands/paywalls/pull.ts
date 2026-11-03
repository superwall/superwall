import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "pull",
  summary: "Bring teammates' published source into this project, merged with your edits",
  args: {
    dir: { describe: "Project directory (default: cwd)" },
  },
  flags: {
    platform: {
      type: "list",
      value: "platform",
      describe: "Limit to the apps of these platforms (repeatable, or comma-separated) - ios, android, web",
    },
    theirs: {
      type: "boolean",
      describe: "Where you and the source repo both changed a file, take the source repo's version",
    },
  },
  examples: [
    ["pull", "Merge what teammates published into this project"],
    ["pull --theirs", "Take the source repo's version of files you both changed"],
  ],
  auth: "none",
  json: false,
  prompts: true,
  mcp: false,
  async run(ctx, input) {
    const { runPull } = await import("@/core/paywalls/pull");
    return runPull(ctx, input);
  },
});
