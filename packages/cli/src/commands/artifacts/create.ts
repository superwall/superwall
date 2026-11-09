import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts create",
  summary: "Start an artifact: a mini-app that adds to the Superwall dashboard",
  args: {
    dir: { describe: "Where to put it (default: my-artifact)" },
  },
  flags: {
    install: { type: "boolean", default: true, describe: "Install dependencies after downloading (--no-install to skip)" },
  },
  examples: [
    ["artifacts create", "Download the starter into my-artifact"],
    ["artifacts create churn-copilot", "Name the directory yourself"],
  ],
  auth: "none",
  json: false,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactCreate } = await import("@/core/artifacts/starter");
    await runArtifactCreate(ctx, { dir: args.dir, install: flags.install });
  },
});
