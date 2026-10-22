import { data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runApiRequest } from "@/core/api/request";

export const command = defineCommand({
  name: "post",
  summary: "Make POST requests to the Superwall API",
  args: {
    path: { describe: "API path, e.g. /v2/products", required: true },
  },
  flags: {
    d: data,
  },
  examples: [
    ["post /v2/entitlements -d project_id=<id> -d identifier=pro", "Create an entitlement"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "write",
  run(ctx, { args, flags }) {
    return runApiRequest(ctx, ctx.api, { verb: "post", path: args.path, data: flags.d });
  },
});
