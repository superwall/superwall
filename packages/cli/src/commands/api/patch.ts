import { data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runApiRequest } from "@/core/api/request";

export const command = defineCommand({
  name: "patch",
  summary: "Make PATCH requests to the Superwall API",
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
  mcp: false,
  run(ctx, { args, flags }) {
    return runApiRequest(ctx, ctx.api, { verb: "patch", path: args.path, data: flags.d });
  },
});
