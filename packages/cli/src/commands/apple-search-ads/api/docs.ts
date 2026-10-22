import { defineCommand } from "@/program/command";
import { renderDocs } from "@/core/apple-search-ads/docs";

export const command = defineCommand({
  name: "asa docs",
  summary: "Every endpoint, with Apple's own schema",
  args: {
    resource: { describe: "A resource to list, or a word to search for (default: the whole catalog)" },
    operation: { describe: "One of the resource's operations, for Apple's full request schema" },
  },
  examples: [
    ["asa docs", "Every resource and operation"],
    ["asa docs keywords", "One resource's operations and flags"],
    ["asa docs campaigns create", "Apple's schema for one operation"],
    ["asa docs budget", "Search the catalog"],
  ],
  auth: "none",
  json: true,
  prompts: false,
  mcp: "read",
  async run(ctx, { args }) {
    const md = await renderDocs(ctx, args.resource, args.operation);
    if (ctx.json) return ctx.output.data({ markdown: md });
    ctx.output.text(md);
  },
});
