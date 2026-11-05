import { app, projectDir, artifact } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts open",
  summary: "Open an artifact in the dashboard",
  args: {
    entrypoint: { describe: "An entrypoint to open inside an app, with --app" },
  },
  flags: {
    app: { ...app, describe: "The app to open the entrypoint in" },
    dir: projectDir,
    artifact,
    org: { type: "string", value: "id", describe: "The organization of a --artifact slug" },
    open: { type: "boolean", default: true, describe: "Open your browser at a terminal (--no-open to only print the link)" },
  },
  examples: [
    ["artifacts open", "This project's artifact"],
    ["artifacts open panel --app 5678", "One entrypoint, inside an app"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactOpen } = await import("@/core/artifacts/install");
    await runArtifactOpen(ctx, { entrypoint: args.entrypoint, ...flags });
  },
});
