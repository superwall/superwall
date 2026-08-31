import type { SuperwallApi } from "./client";
import { listProjects, type Application, type Project } from "./resources";

export const ASA_API_PREFIX = "/api/v5";

function asaBase(api: SuperwallApi): string {
  const orgId = api.org.id;
  if (!orgId)
    throw new Error("No organization selected - run `superwall orgs use <id|name>` first.");
  return `/v2/organizations/${orgId}/apple-search-ads`;
}

export function asaUpstreamPath(path: string): string {
  if (!path.startsWith("/")) throw new Error(`Path must start with "/", e.g. /campaigns`);
  return path.startsWith("/api/") ? path : `${ASA_API_PREFIX}${path}`;
}

export interface AsaProxyOptions {
  orgId?: string;
}

export async function asaProxy<T>(
  api: SuperwallApi,
  appId: string,
  method: string,
  asaPath: string,
  body?: unknown,
  options: AsaProxyOptions = {},
): Promise<T> {
  const path = `${asaBase(api)}/proxy/${appId}${asaUpstreamPath(asaPath)}`;
  const request = options.orgId ? { headers: { "x-ap-context": `orgId=${options.orgId}` } } : {};
  switch (method.toUpperCase()) {
    case "GET":
      return api.get<T>(path, request);
    case "POST":
      return api.post<T>(path, body ?? {}, request);
    case "PUT":
      return api.put<T>(path, body ?? {}, request);
    case "DELETE":
      return api.del<T>(path, request);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

export interface AsaApp {
  id: string;
  name?: string;
  project?: string;
  connected: boolean;
}

export async function listAsaApps(api: SuperwallApi): Promise<AsaApp[]> {
  const projects = await listProjects(api);
  return projects.flatMap((project: Project) =>
    (project.applications ?? [])
      .filter((app: Application) => (app.platform ?? "ios").toLowerCase() === "ios")
      .map((app) => ({
        id: String(app.id),
        name: app.name,
        project: project.name,
        connected: app.apple_search_ads_configured === true,
      })),
  );
}

export function pickAsaApp(apps: AsaApp[], flag: string | undefined): AsaApp {
  if (flag) {
    const app = apps.find((a) => a.id === flag || a.name === flag);
    if (!app) throw new Error(`No iOS app ${flag} in this organization.`);
    return app;
  }
  const connected = apps.filter((a) => a.connected);
  if (connected.length === 1) return connected[0]!;
  if (connected.length === 0) {
    throw new Error(
      "Apple Search Ads isn't connected on any app. Connect it in the dashboard (app → Integrations → Apple Search Ads → Advanced), or pass --app <id>.",
    );
  }
  const names = connected.map((a) => `${a.name ?? a.id} (${a.id})`).join(", ");
  throw new Error(`Apple Search Ads is connected on several apps (${names}). Pass --app <id>.`);
}
