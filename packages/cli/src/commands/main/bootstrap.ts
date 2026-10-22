import { app, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { buildAccountTree, renderAccountTree } from "@/core/main/bootstrap";
import { apiCall } from "@/ui/spinner";

export const command = defineCommand({
  name: "bootstrap",
  summary: "Everything at once: projects, apps, campaigns, products",
  details: "The complete account tree: organizations, projects, apps, campaigns and their placements,\npaywalls, products and entitlements.",
  flags: {
    app: { ...app, describe: "Only the project of this app (id or dashboard link)" },
    project: { ...project, describe: "Only this project" },
  },
  examples: [
    ["bootstrap", "Your whole account as a tree"],
    ["bootstrap --app <app> --json", "One app's project, for a script"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "read",
  async run(ctx, { flags }) {
    const only = { app: flags.app, project: flags.project };
    const tree = await apiCall(ctx, "Loading your account", () => buildAccountTree(ctx.api, only));
    if (ctx.json) return ctx.output.data(tree);
    if (ctx.api.userEmail) ctx.ui.step(ctx.api.userEmail);
    ctx.output.text(renderAccountTree(tree));
  },
});
