import { data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runApiRequest } from "@/core/api/request";

export const command = defineCommand({
  name: "delete",
  summary: "Make DELETE requests to the Superwall API",
  args: {
    path: { describe: "API path, e.g. /v2/products", required: true },
  },
  flags: {
    d: data,
  },
  examples: [
    ["delete /v2/products/<id>", "Delete a product"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: false,
  run(ctx, { args, flags }) {
    return runApiRequest(ctx, ctx.api, { verb: "delete", path: args.path, data: flags.d });
  },
});
