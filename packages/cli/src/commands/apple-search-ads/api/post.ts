import { app, data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runAsaRequest } from "@/core/apple-search-ads/request";

export const command = defineCommand({
  name: "asa post",
  summary: "Any POST request to the Apple Search Ads API",
  args: {
    path: { describe: "Apple Search Ads API path, e.g. /campaigns (the /api/v5 prefix is added)", required: true },
  },
  flags: {
    app: { ...app, describe: "Superwall app id or name (if several have Apple Search Ads connected)" },
    orgId: { type: "string", value: "id", describe: "Apple Search Ads org id (X-AP-Context), if the API user spans several" },
    d: { ...data, describe: "Body field, Stripe-style: -d key=value (string) or key:=value (number/bool/json); nesting via key[sub]" },
    body: { type: "string", value: "json", describe: "Request body as JSON: inline, @file, or @- for stdin; -d fields merge into it" },
  },
  examples: [
    ["asa post /campaigns/find --body '{\"conditions\":[]}'", "A raw selector query"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "write",
  async run(ctx, { args, flags }) {
    const res = await runAsaRequest(ctx, ctx.api, { verb: "post", path: args.path, data: flags.d, orgId: flags.orgId, body: flags.body });
    ctx.output.data(res ?? { ok: true });
  },
});
