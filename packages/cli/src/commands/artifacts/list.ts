import { projectDir } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts list",
  summary: "List an organization's artifacts",
  flags: {
    org: { type: "string", value: "id", describe: "The organization (default: this project's, or asks)" },
    dir: projectDir,
  },
  examples: [["artifacts list --org 1234", "Every artifact in organization 1234"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { flags }) {
    const { runArtifactList } = await import("@/core/artifacts/install");
    await runArtifactList(ctx, flags);
  },
});
