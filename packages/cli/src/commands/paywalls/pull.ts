import { defineCommand } from "@/program/command";
import { app } from "@/program/flags";

export const command = defineCommand({
  name: "pull",
  summary: "Bring teammates' published source into this project, merged with your edits",
  args: {
    dir: {
      describe:
        "Project directory, or with --app the folder to create superwall/ in (default: cwd)",
    },
  },
  flags: {
    app: {
      ...app,
      describe:
        "Set up a new project from this app's source (id, name or dashboard link) in an empty folder",
    },
    platform: {
      type: "list",
      value: "platform",
      describe:
        "Limit to the apps of these platforms (repeatable, or comma-separated) - ios, android, web",
    },
    theirs: {
      type: "boolean",
      describe: "Where you and the source repo both changed a file, take the source repo's version",
    },
  },
  examples: [
    ["pull", "Merge what teammates published into this project"],
    ["pull --theirs", "Take the source repo's version of files you both changed"],
    ["pull --app 20749", "Get every paywall of app 20749 into ./superwall, no GitHub needed"],
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
