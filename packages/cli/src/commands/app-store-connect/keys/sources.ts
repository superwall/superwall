import { app, project } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runAscKeysSources } from "@/core/app-store-connect/keys/saved";

export const command = defineCommand({
  name: "asc keys sources",
  summary: "Keys on your organization's other iOS apps that import could use",
  flags: {
    app: { ...app, describe: "The iOS app: id, name or dashboard link" },
    project,
  },
  examples: [["asc keys sources --app <app>", "What asc keys import could reuse for the app"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  run(ctx, input) {
    return runAscKeysSources(ctx, input);
  },
});
