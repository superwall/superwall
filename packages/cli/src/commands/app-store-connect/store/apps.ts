import { app, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { listAscApps } from "@/core/app-store-connect/store/products";
import { resolveAscOrgApi, resolveAscTeam } from "@/core/app-store-connect/api/request";
import { apiCall } from "@/ui/spinner";

export const command = defineCommand({
  name: "asc apps",
  summary: "Your apps in App Store Connect: name, bundle ID and id",
  flags: {
    team: { ...team, describe: "Apple team id, when your organization has several" },
    app: { ...app, describe: "An app of the organization whose App Store Connect key to use: id, name or dashboard link" },
    project,
  },
  examples: [["asc apps", "Your apps at Apple"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  async run(ctx, { flags }) {
    const api = await resolveAscOrgApi(ctx);
    const teamId = await resolveAscTeam(ctx, api, flags.team);
    const apps = await apiCall(ctx, "Loading apps", () => listAscApps(api, teamId));
    if (ctx.json) return ctx.output.data(apps);
    ctx.ui.step(`${apps.length} app${apps.length === 1 ? "" : "s"}`);
    for (const a of apps) ctx.ui.info(`\`${a.name ?? a.id}\`  ${a.bundleId ?? ""}  ${a.id}`);
  },
});
