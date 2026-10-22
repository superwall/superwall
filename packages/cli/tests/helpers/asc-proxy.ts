import type { SuperwallApi } from "@/core/api/client";

const ASC = "/v2/organizations/7/app-store-connect";

export const STORE = {
  "GET /v1/apps?filter[bundleId]=com.acme.app&fields[apps]=bundleId&limit=10": { data: [{ id: "555" }] },
  "GET /v1/apps/555/subscriptionGroups?limit=200": { data: [{ id: "G1", attributes: { referenceName: "Pro" } }] },
  "GET /v1/subscriptionGroups/G1/subscriptions?limit=200": {
    data: [{ id: "S1", attributes: { productId: "pro.monthly", name: "Monthly", subscriptionPeriod: "ONE_MONTH" } }],
  },
  "GET /v1/apps/555/inAppPurchasesV2?limit=200": {
    data: [{ id: "I1", attributes: { productId: "coins.100", name: "Coins", inAppPurchaseType: "CONSUMABLE" } }],
  },
};

export function fakeAscApi(responses: Record<string, unknown> = {}, teams: unknown[] = [{ team_id: "T1" }]) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const handle = (method: string, path: string, body?: unknown): unknown => {
    requests.push({ method, path, ...(body === undefined ? {} : { body }) });
    if (path === ASC) return { data: teams };
    const proxied = path.replace(/^\/v2\/organizations\/7\/app-store-connect\/proxy\/[^/]+/, "");
    return responses[`${method} ${proxied}`] ?? { data: [] };
  };
  const api: Partial<SuperwallApi> = {
    org: {},
    forOrg: (id: string) => ({ ...(api as SuperwallApi), org: { id } }),
    list: async () => [{ id: 2, organization_id: "7", applications: [{ id: 20, platform: "ios" }] }] as never[],
    get: async (path) => handle("GET", path) as never,
    post: async (path, body) => handle("POST", path, body) as never,
    patch: async (path, body) => handle("PATCH", path, body) as never,
    del: async (path) => handle("DELETE", path) as never,
  };
  return { api, requests };
}

export type AscReply = unknown;
export type AscSent = { method: string; path: string; body?: unknown };

export function ascRoutes(routes: Record<string, AscReply | ((body: unknown) => AscReply)>, teams: unknown[] = [{ team_id: "T1" }]) {
  const sent: AscSent[] = [];
  const handle = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (path === ASC) return { data: teams };
    const proxied = path.replace(/^\/v2\/organizations\/7\/app-store-connect\/proxy\/[^/]+/, "");
    sent.push({ method, path: proxied, ...(body === undefined ? {} : { body }) });
    const key = `${method} ${proxied}`;
    if (!(key in routes)) throw new Error(`No route for ${key}`);
    const reply = routes[key];
    const value = typeof reply === "function" ? reply(body) : reply;
    if (value instanceof Error) throw value;
    return value;
  };
  const api: Partial<SuperwallApi> = {
    org: {},
    forOrg: (id: string) => ({ ...(api as SuperwallApi), org: { id } }),
    list: async () => [{ id: 2, organization_id: "7", applications: [{ id: 20, platform: "ios" }] }] as never[],
    get: async (path) => handle("GET", path) as never,
    post: async (path, body) => handle("POST", path, body) as never,
    patch: async (path, body) => handle("PATCH", path, body) as never,
    del: async (path) => handle("DELETE", path) as never,
  };
  const writes = () => sent.filter((request) => request.method !== "GET");
  return { api, sent, writes };
}

export function one(type: string, id: string, attributes: Record<string, unknown> = {}, relationships: Record<string, unknown> = {}) {
  return { type, id, attributes, relationships };
}

export function page(data: unknown[], extra: { included?: unknown[]; next?: string } = {}) {
  return {
    data,
    ...(extra.included ? { included: extra.included } : {}),
    links: { self: "https://api.appstoreconnect.apple.com/v1/x", ...(extra.next ? { next: `https://api.appstoreconnect.apple.com${extra.next}` } : {}) },
  };
}

export const link = (type: string, id: string) => ({ data: { type, id } });
