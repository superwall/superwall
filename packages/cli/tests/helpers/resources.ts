import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SuperwallApi } from "@/core/api/client";
import type { DocOperation } from "@/core/api/reference";

export interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

export const PROJECTS = [
  { id: "282", name: "test", organization_id: 3642, applications: [{ id: "5861", name: "Demo", platform: "ios" }] },
];

export function op(method: string, path: string, extra: Partial<DocOperation> = {}): DocOperation {
  return { method, path, group: "Test", summary: `${method} ${path}`, params: [], returns: [], ...extra };
}

export function writeApiIndex(operations: DocOperation[]): void {
  const home = process.env.SUPERWALL_HOME ?? "";
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "api-index.json"), JSON.stringify({ version: "test", fetchedAt: Date.now(), operations }));
}

export function fakeResourceApi(
  calls: ApiCall[],
  responses: Record<string, unknown> = {},
  projects: unknown[] = PROJECTS,
): SuperwallApi {
  const answer = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, ...(body === undefined ? {} : { body }) });
    return Promise.resolve(responses[`${method} ${path}`] ?? { ok: true });
  };
  const fake = {
    org: {},
    userEmail: undefined,
    host: "https://api.example.com",
    forOrg: () => fakeResourceApi(calls, responses, projects),
    list: async (path: string) => {
      if (/^\/v2\/projects(\?|$)/.test(path)) return projects;
      calls.push({ method: "LIST", path });
      const response = responses[`LIST ${path}`];
      return Array.isArray(response) ? response : [];
    },
    get: (path: string) => answer("GET", path),
    post: (path: string, body: unknown) => answer("POST", path, body),
    put: (path: string, body: unknown) => answer("PUT", path, body),
    patch: (path: string, body: unknown) => answer("PATCH", path, body),
    del: (path: string) => answer("DELETE", path),
    postText: async () => "",
  };
  return fake as unknown as SuperwallApi;
}
