import { app, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { listAppKeys, listOrganizationKeys } from "@/core/app-store-connect/keys/saved";

export const command = defineCommand({
  name: "asc keys list",
  summary: "Which keys the app has; without --app, your organization's",
  details: "Key id and issuer id of each. Changes nothing.",
  flags: {
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
  },
  examples: [
    ["asc keys list --app <app>", "Which Apple keys an app has"],
    ["asc keys list", "Your organization's keys, the ones the signed proxy uses"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  run(ctx, { flags }) {
    if (flags.app === undefined) return listOrganizationKeys(ctx);
    return listAppKeys(ctx, { app: flags.app, project: flags.project });
  },
});
