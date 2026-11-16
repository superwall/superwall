import { app, data } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runAsaRequest } from "@/core/apple-search-ads/request";

export const command = defineCommand({
  name: "asa delete",
  summary: "Any DELETE request to the Apple Search Ads API",
  args: {
    path: { describe: "Apple Search Ads API path, e.g. /campaigns (the /v1 prefix is added)", required: true },
  },
  flags: {
    app: { ...app, describe: "Superwall app id or name (if several have Apple Search Ads connected)" },
    adAccountId: { type: "string", value: "id", describe: "Apple Ads ad account id (X-AP-Context), if the API user reaches several" },
    d: { ...data, describe: "Query param, Stripe-style: -d key=value (string) or key:=value (number/bool/json)" },
  },
  examples: [
    ["asa delete /campaigns/<id>", "Delete a campaign"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "destructive",
  async run(ctx, { args, flags }) {
    const res = await runAsaRequest(ctx, ctx.api, { verb: "delete", path: args.path, data: flags.d, adAccountId: flags.adAccountId });
    ctx.output.data(res ?? { ok: true });
  },
});
