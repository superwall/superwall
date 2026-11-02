import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "publish",
  summary: "Push and promote in one step - build, version, and ship to production",
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
    existing: {
      type: "boolean",
      describe: "Only paywalls already on Superwall - skip any not in superwall.lock instead of creating them",
    },
    source: {
      type: "boolean",
      describe: "Push the project source to every app, also those whose paywalls did not change (shared files such as the design system)",
    },
  },
  examples: [
    ["publish", "Push every changed paywall and funnel and make it live"],
    ['publish --id plus-upgrade --platform ios -m "New annual price"', "Ship one paywall on one platform and record why"],
    [
      'publish --existing --source -m "Rounder corners"',
      "Ship a design-system change: every paywall already on Superwall that it rebuilds, and every app's source",
    ],
  ],
  auth: "none",
  json: false,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, input) {
    const { runPush } = await import("@/core/paywalls/pipeline/push");
    return runPush(ctx, input, true);
  },
});
