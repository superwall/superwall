import { data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runApiRequest } from "@/core/api/request";

export const command = defineCommand({
  name: "patch",
  summary: "Make PATCH requests to the Superwall API",
  details: "Executes an arbitrary Superwall PATCH endpoint. Depending on the path, it overwrites account configuration or redirects webhook delivery to a caller-supplied HTTPS destination.",
  args: {
    path: { describe: "API path, e.g. /v2/products", required: true },
  },
  flags: {
    d: data,
  },
  examples: [
    ["patch /v2/projects/<id> -d name=Renamed", "Rename a project"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "destructive",
  run(ctx, { args, flags }) {
    return runApiRequest(ctx, ctx.api, { verb: "patch", path: args.path, data: flags.d });
  },
});
