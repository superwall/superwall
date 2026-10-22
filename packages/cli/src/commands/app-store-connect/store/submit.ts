import { app, dryRun, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runAscSubmit } from "@/core/app-store-connect/resources/submit";

export const command = defineCommand({
  name: "asc submit",
  summary: "Submit subscriptions, groups and in-app purchases for App Review",
  details: `Adds the latest version of each to the app's open review submission, or a new one,
then submits it. Apple reviews a first subscription or in-app purchase together with
an app version.`,
  flags: {
    ascApp: { type: "string", value: "id|bundle id", describe: "The App Store app", mcp: "required" },
    subscription: { type: "list", value: "id", describe: "A subscription to submit (repeatable)" },
    group: { type: "list", value: "id", describe: "A subscription group to submit (repeatable)" },
    iap: { type: "list", value: "id", describe: "An in-app purchase to submit (repeatable)" },
    team: { ...team, describe: "Apple team id, when your organization has several" },
    app: { ...app, describe: "A Superwall app of the organization whose App Store Connect key to use: id, name or dashboard link" },
    project,
    dryRun: { ...dryRun, describe: "Print every request it would send; send no change" },
  },
  examples: [["asc submit --asc-app com.example.app --group <id> --subscription <id>", "Submit a group and its subscription"]],
  auth: "required",
  json: true,
  prompts: true,
  mcp: "write",
  run(ctx, { flags }) {
    return runAscSubmit(ctx, { ascApp: flags.ascApp, subscription: flags.subscription, group: flags.group, iap: flags.iap, team: flags.team });
  },
});
