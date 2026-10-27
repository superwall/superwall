import { defineCommand } from "@/program/command";
import { runAscDocs } from "@/core/app-store-connect/api/schema";

export const command = defineCommand({
  name: "asc docs",
  summary: "Apple's exact request schema for an endpoint",
  details: `A path (/v1/…), optionally with a verb, shows that endpoint's schema; words search every
endpoint; nothing lists the top-level resources. The schema is cached and refreshed weekly
in the background; --refresh downloads it now.`,
  args: {
    query: { describe: "An endpoint path and verb (/v1/subscriptionGroups post), or words to search for", variadic: true },
  },
  flags: {
    refresh: { type: "boolean", describe: "Download Apple's latest schema first" },
    quiet: { type: "boolean", describe: "Suppress progress output", hidden: true },
  },
  examples: [
    ["asc docs /v1/subscriptionGroups post", "What creating a subscription group takes"],
    ["asc docs subscription prices", "Find the endpoints for subscription prices"],
    ["asc docs --refresh", "Download Apple's latest schema"],
  ],
  auth: "none",
  json: true,
  prompts: false,
  mcp: false,
  run(ctx, input) {
    return runAscDocs(ctx, input);
  },
});
