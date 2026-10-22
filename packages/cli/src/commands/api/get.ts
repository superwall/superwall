import { data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runApiRequest } from "@/core/api/request";

export const command = defineCommand({
  name: "get",
  summary: "Make GET requests to the Superwall API",
  args: {
    path: { describe: "API path, e.g. /v2/products", required: true },
  },
  flags: {
    d: data,
  },
  examples: [
    ["get /v2/products -d project_id=<id>", "A project's products"],
    ["get /v2/campaigns -d project_id=<id> -d limit=10", "A project's first ten campaigns"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "read",
  run(ctx, { args, flags }) {
    return runApiRequest(ctx, ctx.api, { verb: "get", path: args.path, data: flags.d });
  },
});
