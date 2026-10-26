import { productVariables, type DashboardProduct } from "@superwall/studio/products";
import type { SuperwallApi } from "@/core/api/client";
import type { ProductStores, VersionStore } from "@/core/api/resources";
import { findApplication } from "@/core/api/lookup";

export { productVariables };

type CatalogueRow = DashboardProduct & { platform?: unknown; store?: unknown };

export interface ProjectCatalogue {
  variables: Record<string, Record<string, unknown>>;
  stores: ProductStores;
}

function storeOf(row: CatalogueRow): VersionStore | undefined {
  if (row.platform === "stripe") return "stripe";
  if (row.store === "custom" || row.platform === "custom") return "custom";
  if (row.store === "app_store") return "app-store";
  if (row.store === "play_store") return "play-store";
  return undefined;
}

export async function listProjectCatalogue(
  api: SuperwallApi,
  projectId: string,
): Promise<ProjectCatalogue> {
  const rows = await api.list<CatalogueRow>(
    `/v2/products?project_id=${encodeURIComponent(projectId)}`,
  );
  const variables: Record<string, Record<string, unknown>> = {};
  const stores: Record<string, VersionStore[]> = {};
  for (const row of rows) {
    if (!row.identifier) continue;
    variables[row.identifier] = productVariables(row);
    const store = storeOf(row);
    if (store === undefined) continue;
    const known = (stores[row.identifier] ??= []);
    if (!known.includes(store)) known.push(store);
  }
  return { variables, stores };
}

export async function listProjectProducts(
  api: SuperwallApi,
  projectId: string,
): Promise<Record<string, Record<string, unknown>>> {
  return (await listProjectCatalogue(api, projectId)).variables;
}

export async function listApplicationCatalogue(
  api: SuperwallApi,
  applicationId: string,
): Promise<ProjectCatalogue> {
  const projectId = await projectForApplication(api, applicationId);
  if (projectId === undefined) return { variables: {}, stores: {} };
  return listProjectCatalogue(api, projectId);
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
