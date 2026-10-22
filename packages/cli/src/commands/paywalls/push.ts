import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "push",
  summary: "Build and push your paywalls as immutable versions (production untouched)",
  args: {
    dir: { describe: "Project directory (default: cwd)" },
  },
  flags: {
    id: { type: "list", value: "id", describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)" },
    platform: {
      type: "list",
      value: "platform",
      describe: "Limit to these platforms (repeatable, or comma-separated) - ios, android, web",
    },
    rename: {
      type: "list",
      value: "old=new",
      describe:
        "Declare a renamed directory as <old>=<new> (repeatable) - required in CI, where the resolver cannot prompt",
    },
    message: {
      type: "string",
      alias: "m",
      value: "note",
      describe:
        "Publish note recorded in the source commit (only lands when this publish creates a new source commit — unchanged source reuses the existing commit)",
    },
    overwriteSource: {
      type: "boolean",
      describe: "Replace the remote source with yours even though it can't be merged",
    },
  },
  examples: [
    ["push", "Push every changed paywall and funnel as a new version"],
    ['push --id plus-upgrade -m "New annual price"', "Push one paywall and record why"],
  ],
  auth: "none",
  json: false,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, input) {
    const { runPush } = await import("@/core/paywalls/pipeline/push");
    return runPush(ctx, input, false);
  },
});
