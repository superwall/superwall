import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "build",
  summary: "Build your paywalls into the snapshot documents a push would version, without pushing",
  args: {
    dir: { describe: "Project directory (default: cwd)" },
  },
  flags: {
    id: { type: "list", value: "id", describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)" },
    platform: {
      type: "list",
      value: "platform",
      describe:
        "Build for these platforms (repeatable, or comma-separated) - ios, android, web. Default: one platform-neutral document",
    },
    out: { type: "string", value: "dir", describe: "Directory to write into (default: superwall/.superwall/build)" },
  },
  examples: [
    ["build --id plus-upgrade --platform ios", "Build one paywall for iOS"],
    ["build --json", "Build everything and list the files as JSON"],
  ],
  auth: "none",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runBuildPipeline } = await import("@/core/paywalls/pipeline/build");
    await runBuildPipeline(
      { output: ctx.output, json: ctx.json },
      { dir: args.dir, ids: flags.id, platforms: flags.platform, out: flags.out },
    );
  },
});
