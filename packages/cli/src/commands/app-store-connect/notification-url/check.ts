import { app, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { checkServerNotifications } from "@/core/api/integrations";
import { chooseKeyApp } from "@/core/app-store-connect/keys/app";
import { printServerNotifications } from "@/core/app-store-connect/notification-url";
import { apiCall } from "@/ui/spinner";

export const command = defineCommand({
  name: "asc notification-url check",
  summary: "Ask Apple whose URL each environment has",
  details: `For production and sandbox: this_app, superwall_app (another Superwall app's), other
(RevenueCat, your own server) or none. Changes nothing. Exit 1 when skipped or failed.`,
  flags: {
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
  },
  examples: [["asc notification-url check --app <app>", "Whose URL Apple sends events to"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  async run(ctx, { flags }) {
    const { app } = await chooseKeyApp(ctx, { app: flags.app, project: flags.project });
    const outcome = await apiCall(ctx, "Reading the server notification URL", () => {
      return checkServerNotifications(ctx.api, app);
    });
    const ok = outcome.status !== "failed" && outcome.status !== "skipped";
    printServerNotifications(ctx, app.applicationId, outcome, ok);
  },
});
