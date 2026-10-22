import { defineCommand } from "@/program/command";
import { CONNECT_HINT, runAsaKeys } from "@/core/apple-search-ads/request";

export const command = defineCommand({
  name: "asa keys",
  summary: "Which apps have Apple Search Ads connected",
  details: CONNECT_HINT,
  args: {
    action: { describe: "list (the default); credentials are connected in the dashboard, not here" },
  },
  examples: [["asa keys", "Every iOS app and whether Apple Search Ads is connected"]],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "read",
  run(ctx, input) {
    return runAsaKeys(ctx, input);
  },
});
