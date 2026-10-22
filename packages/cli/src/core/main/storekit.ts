import { writeFileSync } from "node:fs";
import type { CommandContext } from "@/program/command";
import { pickScope } from "@/core/account/scope";
import type { SuperwallApi } from "@/core/api/client";
import { listResource, type Row } from "@/core/api/resources";
import { formatJson } from "@/program/output";
import { apiCall } from "@/ui/spinner";
import { textOf } from "./input";

export async function writeStoreKit(context: CommandContext, api: SuperwallApi, out: unknown): Promise<void> {
  const scope = await pickScope(context, api, false);
  const products = await apiCall(context, "Loading products", () =>
    listResource(api, "products", scope),
  );
  const outFile = textOf(out) ?? "Superwall.storekit";
  writeFileSync(outFile, `${formatJson(generateStoreKit(products))}\n`);
  if (context.json) {
    return context.output.data({ path: outFile, products: products.length });
  }
  context.ui.success(
    `Wrote \`${outFile}\` with ${products.length} product${products.length === 1 ? "" : "s"}`,
  );
}

export function generateStoreKit(products: Row[]): object {
  const items = products
    .map((p) => String(p.identifier ?? p.product_identifier ?? p.name ?? ""))
    .filter(Boolean);

  return {
    identifier: "SUPERWALL",
    nonRenewingSubscriptions: [],
    products: items.map((id, i) => ({
      displayPrice: "9.99",
      familyShareable: false,
      internalID: String(1000 + i),
      localizations: [{ description: id, displayName: id, locale: "en_US" }],
      productID: id,
      referenceName: id,
      type: "NonConsumable",
    })),
    settings: { _applicationInternalID: "SUPERWALL" },
    subscriptionGroups: [],
    version: { major: 3, minor: 0 },
  };
}
