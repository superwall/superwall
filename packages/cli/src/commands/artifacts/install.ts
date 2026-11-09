import { app, projectDir, artifact, yes } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts install",
  summary: "Choose where an entrypoint shows",
  details:
    "Admins only. Installs an entrypoint of the live version for the whole organization, or one app with --app. An app's row overrides the organization's there. Without an entrypoint, lists what's installed.",
  args: {
    entrypoint: { describe: "The entrypoint id from superwall.json" },
  },
  flags: {
    app: { ...app, describe: "Install it for this app only (default: the whole organization)" },
    disable: { type: "boolean", describe: "Turn it off here, keeping its row" },
    remove: { type: "boolean", describe: "Remove its row, which ends sessions that are open" },
    position: { type: "number", value: "n", describe: "Order among the entrypoints shown in one slot, lowest first" },
    dir: projectDir,
    artifact,
    org: { type: "string", value: "id", describe: "The organization of a --artifact slug" },
    yes: { ...yes, describe: "With --remove: go ahead without asking" },
  },
  examples: [
    ["artifacts install", "List what's installed"],
    ["artifacts install churn --app 5678", "Show it in one app"],
    ["artifacts install churn --remove --yes", "Remove the organization-wide row"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactInstall } = await import("@/core/artifacts/install");
    await runArtifactInstall(ctx, { entrypoint: args.entrypoint, ...flags });
  },
});
