import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts update",
  summary: "Refresh an artifact's vendored SDK from the public repo",
  args: {
    dir: { describe: "The artifact (default: cwd)" },
  },
  flags: {
    install: { type: "boolean", default: true, describe: "Update the lockfile after downloading (--no-install to skip)" },
    force: { type: "boolean", describe: "Replace a vendored SDK that's newer than the latest published one" },
  },
  examples: [["artifacts update", "Replace vendor/artifact-sdk with the latest and update the lockfile"]],
  auth: "none",
  json: false,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactUpdate } = await import("@/core/artifacts/starter");
    await runArtifactUpdate(ctx, { dir: args.dir, install: flags.install, force: flags.force });
  },
});
