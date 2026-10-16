import { defineCommand } from "@/command";
import { apiCall } from "@/commands/api-output";
import { findOperations, loadApiIndex, renderApiDocs, searchOperations } from "@/core/api/api-docs";

const METHOD = /^(get|post|put|patch|delete)$/i;

export const runApiDocs = defineCommand({
  name: "api docs",
  interaction: "none",
  output: "both",
  async run(ctx) {
    if (ctx.argv.action !== "docs") {
      throw new Error("Usage: superwall api docs [words | /v2/path [method]]");
    }
    const words = ([] as unknown[]).concat(ctx.argv.query ?? []).map(String);
    let method = words.find((word) => METHOD.test(word));
    const query = words.filter((word) => word !== method).join(" ");
    method = method?.toUpperCase();

    const index = await apiCall(ctx, "Loading the API reference", () =>
      loadApiIndex({ refresh: Boolean(ctx.argv.refresh) }),
    );
    if (ctx.json) {
      const operations = query.startsWith("/")
        ? findOperations(index, query, method)
        : query
          ? searchOperations(index, query)
          : index.operations;
      return ctx.output.data({ version: index.version, operations });
    }
    ctx.output.text(renderApiDocs(index, query, method));
  },
});
