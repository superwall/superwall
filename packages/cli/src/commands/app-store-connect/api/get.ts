import { app, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { sendAscRequest } from "@/core/app-store-connect/api/request";

export const command = defineCommand({
  name: "asc get",
  summary: "Any App Store Connect GET request, through the signed proxy",
  args: {
    path: { describe: "The App Store Connect path, e.g. /v1/apps", required: true },
  },
  flags: {
    team: { ...team, describe: "Apple team id, when your organization has several" },
    app: { ...app, describe: "An app of the organization whose App Store Connect key signs it: id, name or dashboard link" },
    project,
  },
  examples: [
    ["asc get /v1/apps", "Your apps at Apple"],
    ["asc get /v1/apps/<asc-app-id>/inAppPurchasesV2", "An app's in-app purchases"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx, { args, flags }) {
    const response = await sendAscRequest(ctx, "get", args.path, { data: [], team: flags.team, force: false });
    ctx.output.data(response);
  },
});
