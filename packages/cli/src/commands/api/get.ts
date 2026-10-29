import { data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runApiRequest } from "@/core/api/request";

export const command = defineCommand({
  name: "get",
  summary: "Make GET requests to the Superwall API",
  details: "Executes an arbitrary Superwall GET endpoint. Most retrieve account data, but the analytics query endpoint can provision credentials and reconcile existing access policies before running read-only SQL.",
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
  mcp: "destructive",
  run(ctx, { args, flags }) {
    return runApiRequest(ctx, ctx.api, { verb: "get", path: args.path, data: flags.d });
  },
});
