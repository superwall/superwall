import { app, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { sendAscRequest } from "@/core/app-store-connect/api/request";

export const command = defineCommand({
  name: "asc delete",
  summary: "Any App Store Connect DELETE request, through the signed proxy",
  args: {
    path: { describe: "The App Store Connect path, e.g. /v1/apps", required: true },
  },
  flags: {
    team: { ...team, describe: "Apple team id, when your organization has several" },
    app: { ...app, describe: "An app of the organization whose App Store Connect key signs it: id, name or dashboard link" },
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
    const response = await sendAscRequest(ctx, "delete", args.path, { data: [], team: flags.team, force: false });
    ctx.output.data(response);
  },
});
