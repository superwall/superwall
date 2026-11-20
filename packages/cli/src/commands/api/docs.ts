import { defineCommand } from "@/program/command";
import { renderApiDocs, resolveApiIndex, METHOD, listMatchingOperations } from "@/core/api/reference";
import { resolveCommandLookup, withCommand } from "@/core/api/commands";
import { apiCall } from "@/ui/spinner";

export const command = defineCommand({
  name: "api docs",
  summary: "Every endpoint with its parameters and body",
  args: {
    query: { describe: "Words to search, or a /v2 path and optionally its method", variadic: true },
  },
  flags: {
    refresh: { type: "boolean", describe: "Fetch the reference again now" },
  },
  examples: [
    ["api docs variant", "Find the endpoints for campaign variants"],
    ["api docs /v2/campaigns/{id}/audiences post", "One endpoint in full"],
  ],
  auth: "none",
  json: true,
  prompts: false,
  mcp: "read",
  async run(ctx, { args, flags }) {
    const found = args.query.find((word) => METHOD.test(word));
    const query = args.query.filter((word) => word !== found).join(" ");
    const method = found?.toUpperCase();

    const index = await apiCall(ctx, "Loading the API reference", () => resolveApiIndex({ refresh: flags.refresh }));
    const lookup = resolveCommandLookup();
    if (ctx.json) {
      return ctx.output.data({ version: index.version, operations: listMatchingOperations(index, query, method).map((op) => withCommand(op, lookup)) });
    }
    ctx.output.text(renderApiDocs(index, query, method, lookup));
  },
});
