import { writeFileSync } from "node:fs";
import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { addPlacement, listResource } from "@/core/api/resources";
import { generateStoreKit } from "@/core/dashboard/storekit";
import { apiCall } from "@/commands/api-output";
import { formatJson } from "@/output";
import { pickScope } from "./scope";

export async function addCampaignPlacement(
  context: CommandContext,
  api: SuperwallApi,
): Promise<void> {
  const { ui, json, dryRun, argv } = context;
  const campaignId = argv.value as string | undefined;
  const placement = argv.value2 as string | undefined;
  if (!campaignId || !placement) {
    throw new Error("Usage: superwall campaigns placement <campaignId> <placement>");
  }
  if (dryRun) {
    const plan = { dryRun: true, action: "placement", campaignId, placement };
    if (json) return context.output.data(plan);
    ui.info(`[dry-run] would add placement "${placement}" to campaign ${campaignId}`);
    return;
  }
  const result = await apiCall(context, `Adding placement "${placement}"`, () =>
    addPlacement(api, campaignId, placement),
  );
  if (json) return context.output.data(result);
  ui.success(`Added placement \`${placement}\` to campaign ${campaignId}`);
}

export async function writeStoreKit(context: CommandContext, api: SuperwallApi): Promise<void> {
  const scope = await pickScope(context, api, false);
  const products = await apiCall(context, "Loading products", () =>
    listResource(api, "products", scope),
  );
  const outFile = (context.argv.out as string | undefined) ?? "Superwall.storekit";
  writeFileSync(outFile, `${formatJson(generateStoreKit(products))}\n`);
  if (context.json) {
    return context.output.data({ path: outFile, products: products.length });
  }
  context.ui.success(
    `Wrote \`${outFile}\` with ${products.length} product${products.length === 1 ? "" : "s"}`,
  );
}
