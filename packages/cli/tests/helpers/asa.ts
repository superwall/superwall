import type { SuperwallApi } from "@/core/api/client";

const PROJECTS = [
  {
    id: 1,
    name: "Acme",
    organization_id: "org-1",
    applications: [{ id: 5, name: "Acme iOS", platform: "ios", apple_search_ads_configured: true }],
  },
];

export interface AsaRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export function fakeAsaApi(respond: (method: string, path: string, body?: unknown) => unknown = () => ({ data: [] })) {
  const requests: AsaRequest[] = [];
  const handle = (method: string) => async (path: string, bodyOrOptions?: unknown, options?: unknown) => {
    const body = method === "GET" || method === "DELETE" ? undefined : bodyOrOptions;
    const opts = (method === "GET" || method === "DELETE" ? bodyOrOptions : options) as
      | { headers?: Record<string, string> }
      | undefined;
    requests.push({ method, path, body, headers: opts?.headers });
    const res = respond(method, path, body);
    if (res instanceof Error) throw res;
    return res;
  };
  const api = {
    org: {},
    forOrg: (id: string) => ({ ...api, org: { id } }),
    list: async (path: string) => {
      requests.push({ method: "LIST", path });
      return PROJECTS;
    },
    get: handle("GET"),
    post: handle("POST"),
    put: handle("PUT"),
    del: handle("DELETE"),
  } as unknown as SuperwallApi;
  return { api, requests };
}
