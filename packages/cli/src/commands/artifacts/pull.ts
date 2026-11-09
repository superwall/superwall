import { artifact } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts pull",
  summary: "Bring teammates' pushes into this project, merged with your edits",
  args: {
    dir: { describe: "The artifact project, or with --artifact an empty folder to fill (default: cwd)" },
  },
  flags: {
    artifact,
    org: { type: "string", value: "id", describe: "The organization of a --artifact slug" },
    theirs: { type: "boolean", describe: "Where you and the source repo both changed a file, take the source repo's version" },
  },
  examples: [
    ["artifacts pull", "Merge what teammates pushed into this project"],
    ["artifacts pull --theirs", "Take the source repo's version of files you both changed"],
    ["artifacts pull churn-copilot --artifact 42", "Get artifact 42's source into a new folder"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactPull } = await import("@/core/artifacts/pull");
    await runArtifactPull(ctx, { dir: args.dir, ...flags });
  },
});
