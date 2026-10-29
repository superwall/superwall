import { app, dryRun, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runAscNotificationUrlSet } from "@/core/app-store-connect/notification-url";

export const command = defineCommand({
  name: "asc notification-url set",
  summary: "Write this app's URL where Apple has none",
  details: `Never replaces another server's URL: a conflict is reported and left alone (exit 1).
It leaves the revenue provider alone unless --set-revenue-provider is passed.

Passing --set-revenue-provider overwrites the app's existing revenue-provider selection.`,
  flags: {
    setRevenueProvider: {
      type: "boolean",
      describe: "Also make the store the app's revenue provider. Left out, the provider is not touched",
    },
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
    dryRun: { ...dryRun, describe: "Plan without writing", hidden: true },
  },
  examples: [["asc notification-url set --app <app>", "Send the app's purchase events to Superwall"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "destructive",
  run(ctx, input) {
    return runAscNotificationUrlSet(ctx, input);
  },
});
