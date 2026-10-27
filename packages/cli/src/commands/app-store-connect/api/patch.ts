import { app, project, team } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { sendAscRequest } from "@/core/app-store-connect/api/request";

export const command = defineCommand({
  name: "asc patch",
  summary: "Any App Store Connect PATCH request, its body checked against Apple's schema",
  details: `Each -d names an attribute or a relationship of the body; its type comes from Apple's
schema and its id from the path. A body the schema would refuse is stopped before it is
sent (--force sends it as-is). superwall asc docs <path> patch lists the fields.`,
  args: {
    path: { describe: "The App Store Connect path, e.g. /v1/apps", required: true },
  },
  flags: {
    d: {
      type: "list",
      value: "key=value",
      describe: "Request param, Stripe-style: -d key=value (string) or key:=value (number/bool/json); nesting via key[sub]",
    },
    force: { type: "boolean", describe: "Send the body as-is, without checking it against Apple's schema" },
    team: { ...team, describe: "Apple team id, when your organization has several" },
    app: { ...app, describe: "An app of the organization whose App Store Connect key signs it: id, name or dashboard link" },
    project,
  },
  examples: [
    ["asc patch /v1/apps/<asc-app-id> -d <field>=<value>", "Change one field"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx, { args, flags }) {
    const response = await sendAscRequest(ctx, "patch", args.path, { data: flags.d, team: flags.team, force: flags.force });
    ctx.output.data(response);
  },
});
