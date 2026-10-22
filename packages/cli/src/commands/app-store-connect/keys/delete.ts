import { app, dryRun, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { removeFromApp, removeFromOrganization } from "@/core/app-store-connect/keys/saved";

export const command = defineCommand({
  name: "asc keys delete",
  summary: "Remove the app's saved key; with a team id instead, your organization's",
  details: "Nothing is revoked at Apple.",
  args: {
    key: { describe: "api_key or purchase_key with --app; without --app, the Apple team id of your organization's key" },
  },
  flags: {
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
    dryRun: { ...dryRun, describe: "Plan without writing", hidden: true },
  },
  examples: [
    ["asc keys delete purchase_key --app <app>", "Remove the app's In-App Purchase key"],
    ["asc keys delete <team id>", "Remove your organization's key for that team"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "destructive",
  run(ctx, { args, flags }) {
    if (flags.app === undefined) return removeFromOrganization(ctx, args.key);
    return removeFromApp(ctx, args.key, { app: flags.app, project: flags.project });
  },
});
