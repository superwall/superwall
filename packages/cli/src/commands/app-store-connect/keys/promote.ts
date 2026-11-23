import { app, dryRun, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { promoteKey } from "@/core/app-store-connect/keys/saved";

export const command = defineCommand({
  name: "asc keys promote",
  summary: "Let the signed proxy use the API key saved on an app",
  details: `Copies the app's saved App Store Connect API key to your organization's keys, under
its Apple team, so asc commands can use it. Leaves the organization's key for that team as
it is when it has one. Needs access to every project. Creates nothing at Apple.`,
  flags: {
    app: { ...app, describe: "The iOS app whose key to copy: id, name or dashboard link" },
    project,
    dryRun: { ...dryRun, describe: "Plan without writing", hidden: true },
  },
  examples: [["asc keys promote --app <app>", "Use the app's key for your organization"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "write",
  run(ctx, { flags }) {
    return promoteKey(ctx, { app: flags.app, project: flags.project });
  },
});
