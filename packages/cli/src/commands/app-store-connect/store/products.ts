import { app, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { printAscProducts } from "@/core/app-store-connect/store/shortcuts";

export const command = defineCommand({
  name: "asc products",
  summary: "The products of one App Store app: subscriptions and in-app purchases",
  args: {
    id: { describe: "The app's bundle ID or App Store Connect app id", required: true },
  },
  flags: {
    team: { ...team, describe: "Apple team id, when your organization has several" },
    app: { ...app, describe: "An app of the organization whose App Store Connect key to use: id, name or dashboard link" },
    project,
  },
  examples: [["asc products com.example.app", "Everything the app sells"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "read",
  run(ctx, { args, flags }) {
    return printAscProducts(ctx, args.id, flags.team);
  },
});
