import { data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runApiRequest } from "@/core/api/request";

export const command = defineCommand({
  name: "put",
  summary: "Make PUT requests to the Superwall API",
  details: "Executes an arbitrary Superwall PUT endpoint. Depending on the path, it replaces account configuration whole, such as an audience's traffic weights.",
  args: {
    path: { describe: "API path, e.g. /v2/products", required: true },
  },
  flags: {
    d: data,
  },
  examples: [
    [
      `put /v2/campaigns/<id>/audiences/<audience_id>/weights -d 'weights:=[{"variant_id":"<variant_id>","percentage":100}]'`,
      "Replace an audience's traffic weights",
    ],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "destructive",
  run(ctx, { args, flags }) {
    return runApiRequest(ctx, ctx.api, { verb: "put", path: args.path, data: flags.d });
  },
});
