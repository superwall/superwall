import type { SuperwallApi } from "@/core/api/client";

type Answer = object | string | number | boolean | null;
export type Reply = Answer | ((body: unknown) => Answer);
export type Sent = { method: string; path: string; body?: unknown };

export function routedApi(routes: Record<string, Reply>, org: { id?: string } = {}): { api: SuperwallApi; sent: Sent[] } {
  const sent: Sent[] = [];
  const answer = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    sent.push({ method, path, ...(body === undefined ? {} : { body }) });
    const key = `${method} ${path}`;
    if (!(key in routes)) throw new Error(`No route for ${key}`);
    const reply = routes[key];
    const value = typeof reply === "function" ? reply(body) : reply;
    if (value instanceof Error) throw value;
    return value;
  };
  const api = {
    org,
    userEmail: undefined,
    host: "https://api.example.com",
    forOrg: () => api,
    list: async (path: string) => {
      const value = await answer("GET", path);
      if (Array.isArray(value)) return value;
      const data = (value as { data?: unknown[] }).data;
      return data ?? [];
    },
    get: (path: string) => answer("GET", path),
    post: (path: string, body: unknown) => answer("POST", path, body),
    put: (path: string, body: unknown) => answer("PUT", path, body),
    patch: (path: string, body: unknown) => answer("PATCH", path, body),
    del: (path: string) => answer("DELETE", path),
    postText: async () => "",
  } as unknown as SuperwallApi;
  return { api, sent };
}
