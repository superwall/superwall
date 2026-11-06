import { projectDir, artifact } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts logs",
  summary: "Show a version's build log",
  details: "The last 128 KiB, once the build has finished. The latest version by default.",
  args: {
    version: { describe: "The version id (default: the latest)" },
  },
  flags: {
    dir: projectDir,
    artifact,
    org: { type: "string", value: "id", describe: "The organization of a --artifact slug" },
  },
  examples: [
    ["artifacts logs", "The latest version's build log"],
    ["artifacts logs 7", "Version 7's"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactLogs } = await import("@/core/artifacts/status");
    await runArtifactLogs(ctx, { version: args.version, ...flags });
  },
});
