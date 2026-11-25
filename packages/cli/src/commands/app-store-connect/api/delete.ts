import { app, dryRun, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runAscWrite } from "@/core/app-store-connect/api/request";

export const command = defineCommand({
  name: "asc delete",
  summary: "Any App Store Connect DELETE request, through the signed proxy",
  args: {
    path: { describe: "The App Store Connect path, e.g. /v1/apps", required: true },
  },
  flags: {
    dryRun: { ...dryRun, describe: "Print the request it would send; send nothing" },
    team: { ...team, describe: "Apple team id, when your organization has several" },
    app: { ...app, describe: "Picks the organization: id, name or dashboard link of one of its apps. The organization's key signs the request, not a key saved on the app" },
    project,
  },
  examples: [
    ["asc delete /v1/subscriptionGroups/<id>", "Delete a subscription group"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "destructive",
  async run(ctx, { args, flags }) {
    await runAscWrite(ctx, "delete", args.path, { data: [], team: flags.team, force: false, dryRun: flags.dryRun });
  },
});
