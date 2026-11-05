import { projectDir, artifact } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts status",
  summary: "Show an artifact's state and its latest versions",
  flags: {
    dir: projectDir,
    artifact,
    org: { type: "string", value: "id", describe: "The organization of a --artifact slug" },
    all: { type: "boolean", describe: "List every version, not just the latest and the live one" },
  },
  examples: [
    ["artifacts status", "This project's artifact"],
    ["artifacts status --artifact 42", "Any artifact you can see"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { flags }) {
    const { runArtifactStatus } = await import("@/core/artifacts/status");
    await runArtifactStatus(ctx, flags);
  },
});
