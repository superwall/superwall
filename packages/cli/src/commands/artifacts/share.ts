import { projectDir, artifact } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts share",
  summary: "Ask an admin to review a version",
  details: "The latest built version by default. Until an organization owner or admin approves it, only its author can see it. Nobody is told automatically, so it says who to ask.",
  args: {
    version: { describe: "The version id (default: the latest built)" },
  },
  flags: {
    dir: projectDir,
    artifact,
    org: { type: "string", value: "id", describe: "The organization of a --artifact slug" },
  },
  examples: [["artifacts share", "Ask for review of the latest built version"]],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactShare } = await import("@/core/artifacts/status");
    await runArtifactShare(ctx, { version: args.version, ...flags });
  },
});
