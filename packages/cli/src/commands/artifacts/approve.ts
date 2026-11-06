import { projectDir, artifact, yes } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "artifacts approve",
  summary: "Review what a version can do and make it live",
  details:
    "Admins only. Shows the version's manifest and how it differs from the live version, then asks. Without a terminal it needs --yes, and --accept-changes too when what the artifact can do changes.",
  args: {
    version: { describe: "The version id (default: the latest built that isn't live)" },
  },
  flags: {
    dir: projectDir,
    artifact,
    org: { type: "string", value: "id", describe: "The organization of a --artifact slug" },
    yes: { ...yes, describe: "Go ahead without asking, when nothing it can do changes" },
    acceptChanges: { type: "boolean", describe: "With --yes: also accept changes to what it can do" },
  },
  examples: [
    ["artifacts approve --artifact 42", "Review and approve the latest built version"],
    ["artifacts approve 7 --artifact 42 --json", "Print version 7's manifest and changes, approving nothing"],
    ["artifacts approve 7 --artifact 42 --yes --accept-changes", "Approve it without a terminal, having read them"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runArtifactApprove } = await import("@/core/artifacts/approve");
    await runArtifactApprove(ctx, { version: args.version, ...flags });
  },
});
