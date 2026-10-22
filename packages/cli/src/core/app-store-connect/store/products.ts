import type { SuperwallApi } from "@/core/api/client";
import { ascProxyGet } from "../api/client";

interface AscProduct {
  productId: string;
  referenceName: string;
  type: string;
  state: string;
  subscriptionPeriod?: string;
  subscriptionGroupName?: string;
}

interface AscResource {
  id: string;
  attributes?: Record<string, unknown>;
}
interface AscListResponse {
  data?: AscResource[];
}

function attr(r: AscResource, key: string): string | undefined {
  const v = r.attributes?.[key];
  return typeof v === "string" ? v : undefined;
}

export async function findAscAppId(
  api: SuperwallApi,
  teamId: string,
  bundleId: string,
): Promise<string | undefined> {
  const res = await ascProxyGet<AscListResponse>(
    api,
    teamId,
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId&limit=10`,
  );
  return res.data?.[0]?.id;
}

interface AscApp {
  id: string;
  name?: string;
  bundleId?: string;
}

export async function listAscApps(api: SuperwallApi, teamId: string): Promise<AscApp[]> {
  const res = await ascProxyGet<AscListResponse>(
    api,
    teamId,
    "/v1/apps?limit=200&fields[apps]=bundleId,name",
  );
  return (res.data ?? []).map((a) => ({
    id: a.id,
    name: attr(a, "name"),
    bundleId: attr(a, "bundleId"),
  }));
}

export async function listUnimportedAscProducts(
  api: SuperwallApi,
  teamId: string,
  ascAppId: string,
  existingIds: Set<string>,
): Promise<AscProduct[]> {
  const byId = new Map<string, AscProduct>();

  const groups = await ascProxyGet<AscListResponse>(
    api,
    teamId,
    `/v1/apps/${ascAppId}/subscriptionGroups?limit=200`,
  );
  for (const group of groups.data ?? []) {
    const groupName = attr(group, "referenceName") ?? "";
    const subs = await ascProxyGet<AscListResponse>(
      api,
      teamId,
      `/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`,
    );
    for (const sub of subs.data ?? []) {
      const productId = attr(sub, "productId");
      if (productId && !byId.has(productId)) {
        byId.set(productId, {
          productId,
          referenceName: attr(sub, "name") ?? groupName,
          type: "AUTO_RENEWABLE_SUBSCRIPTION",
          state: attr(sub, "state") ?? "UNKNOWN",
          subscriptionPeriod: attr(sub, "subscriptionPeriod"),
          subscriptionGroupName: groupName,
        });
      }
    }
  }

  const iaps = await ascProxyGet<AscListResponse>(
    api,
    teamId,
    `/v1/apps/${ascAppId}/inAppPurchasesV2?limit=200`,
  );
  for (const iap of iaps.data ?? []) {
    const productId = attr(iap, "productId");
    if (productId && !byId.has(productId)) {
      byId.set(productId, {
        productId,
        referenceName: attr(iap, "name") ?? "",
        type: attr(iap, "inAppPurchaseType") ?? "UNKNOWN",
        state: attr(iap, "state") ?? "UNKNOWN",
      });
    }
  }

  return [...byId.values()].filter((p) => !existingIds.has(p.productId));
}

export function ascTypeDisplay(type: string): string {
  switch (type) {
    case "AUTO_RENEWABLE_SUBSCRIPTION":
    case "AUTOMATICALLY_RENEWABLE_SUBSCRIPTION":
      return "Subscription";
    case "NON_CONSUMABLE":
      return "Non-Consumable";
    case "CONSUMABLE":
      return "Consumable";
    case "NON_RENEWING_SUBSCRIPTION":
      return "Non-Renewing";
    default:
      return type;
  }
}
