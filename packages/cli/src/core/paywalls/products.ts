import { productVariables, type DashboardProduct } from "@superwall/studio/products";
import type { SuperwallApi } from "@/core/api/client";
import { findApplication } from "@/core/api/lookup";

export { productVariables };

export async function listProjectProducts(
  api: SuperwallApi,
  projectId: string,
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await api.list<DashboardProduct>(
    `/v2/products?project_id=${encodeURIComponent(projectId)}`,
  );
  const catalogue: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    if (row.identifier) catalogue[row.identifier] = productVariables(row);
  }
  return catalogue;
}

export async function projectForApplication(
  api: SuperwallApi,
  applicationId: string,
): Promise<string | undefined> {
  const found = await findApplication(api, applicationId).catch(() => undefined);
  return found ? String(found.project.id) : undefined;
}

export class MissingProductError extends Error {}

export function requireProducts(
  catalogue: Record<string, Record<string, unknown>>,
  surfaces: readonly { id: string; products?: Record<string, string> }[],
): void {
  const gaps = surfaces.flatMap((surface) =>
    Object.entries(surface.products ?? {})
      .filter(([, identifier]) => catalogue[identifier] === undefined)
      .map(([reference, identifier]) => `  ${surface.id}: ${reference} → ${identifier}`),
  );
  if (gaps.length === 0) return;

  throw new MissingProductError(
    [
      gaps.length === 1
        ? "This product does not exist on Superwall:"
        : `These ${gaps.length} products do not exist on Superwall:`,
      ...gaps,
      "",
      "Every variable on them would be undefined on device. Add them in the",
      "dashboard, or point the config at products that exist.",
    ].join("\n"),
  );
}
