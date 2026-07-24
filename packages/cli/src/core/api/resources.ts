import { SuperwallApi } from "./client";

export interface Application {
  id: string | number;
  name?: string;
  platform?: string;
  bundle_id?: string;
  public_api_key?: string;
}

export interface Project {
  id: string | number;
  name?: string;
  applications?: Application[];
}

export type Row = Record<string, unknown> & { id?: string | number };

export const RESOURCES = {
  products: "/v2/products",
  campaigns: "/v2/campaigns",
  paywalls: "/v2/paywalls",
  entitlements: "/v2/entitlements",
} as const;

export type ResourceName = keyof typeof RESOURCES | "apps" | "orgs" | "projects";

const RESOURCE_SCOPE: Record<keyof typeof RESOURCES, "project" | "application"> = {
  products: "project",
  entitlements: "project",
  campaigns: "application",
  paywalls: "application",
};

export function isAppScoped(name: keyof typeof RESOURCES): boolean {
  return RESOURCE_SCOPE[name] === "application";
}

export function titleCase(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s;
}

export function platformLabel(platform?: string): string {
  switch ((platform ?? "").toLowerCase()) {
    case "ios":
      return "iOS";
    case "android":
      return "Android";
    case "flutter":
      return "Flutter";
    case "react_native":
    case "react-native":
      return "React Native";
    case "web":
      return "Web";
    default:
      return platform ? platform[0]!.toUpperCase() + platform.slice(1) : "?";
  }
}

export interface Scope {
  projectId: string;
  applicationId?: string;
  projectName?: string;
  appName?: string;
}

export async function listProjects(api: SuperwallApi): Promise<Project[]> {
  // Superadmin tokens span organizations, so the API requires an explicit
  // one; ordinary tokens infer it and ignore the filter.
  const org = api.org?.id;
  return api.list<Project>(
    org ? `/v2/projects?organization_id=${encodeURIComponent(org)}` : "/v2/projects",
  );
}

export async function listApplications(api: SuperwallApi): Promise<Application[]> {
  const projects = await listProjects(api);
  return projects.flatMap((p) => p.applications ?? []);
}

export async function listResource(
  api: SuperwallApi,
  name: keyof typeof RESOURCES,
  scope: Scope,
): Promise<Row[]> {
  if (RESOURCE_SCOPE[name] === "application") {
    if (!scope.applicationId) throw new Error("This project has no application yet.");
    return api.list<Row>(`${RESOURCES[name]}?application_id=${scope.applicationId}`);
  }
  return api.list<Row>(`${RESOURCES[name]}?project_id=${scope.projectId}`);
}

export function createEntitlement(
  api: SuperwallApi,
  scope: Scope,
  identifier: string,
): Promise<Row> {
  return api.post<Row>("/v2/entitlements", {
    project_id: scope.projectId,
    identifier,
  });
}

export type SubscriptionPeriod = "day" | "week" | "month" | "year";

export interface ProductCreateOpts {
  name?: string;
  /** amount is in the smallest unit (cents). */
  price?: { amount: number; currency: string };
  subscription?: {
    period: SubscriptionPeriod;
    period_count?: number;
    trial_period_days?: number;
  };
  entitlements?: string[];
}

export function createProduct(
  api: SuperwallApi,
  scope: Scope,
  identifier: string,
  opts: ProductCreateOpts = {},
): Promise<Row> {
  return api.post<Row>("/v2/products", {
    project_id: scope.projectId,
    identifier,
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.price ? { price: opts.price } : {}),
    ...(opts.subscription ? { subscription: opts.subscription } : {}),
    ...(opts.entitlements?.length ? { entitlements: opts.entitlements } : {}),
  });
}

export async function listOrganizations(api: SuperwallApi): Promise<Row[]> {
  const res = await api.get<{ data?: Row[] }>("/v2/me/organizations");
  return res.data ?? [];
}

export function createProject(api: SuperwallApi, name: string): Promise<Row> {
  const orgId = api.org.id;
  if (!orgId)
    throw new Error("No organization selected - run `superwall orgs use <id|name>` first.");
  return api.post<Row>("/v2/projects", {
    name,
    organization_id: Number(orgId),
  });
}

export function createApplication(
  api: SuperwallApi,
  scope: Scope,
  opts: { name: string; platform: string; bundleId?: string },
): Promise<Row> {
  return api.post<Row>(`/v2/projects/${scope.projectId}/applications`, {
    name: opts.name,
    platform: opts.platform,
    ...(opts.bundleId ? { bundle_id: opts.bundleId } : {}),
  });
}

export function createCampaign(
  api: SuperwallApi,
  scope: Scope,
  description: string,
  placement: string,
): Promise<Row> {
  if (!scope.applicationId)
    throw new Error("This project has no application to create a campaign in.");
  // The API requires >=1 placement and >=1 audience at creation. Seed a 100%
  // holdout so nothing presents until a paywall is attached in the dashboard.
  return api.post<Row>("/v2/campaigns", {
    application_id: scope.applicationId,
    description,
    placements: [{ event_name: placement }],
    audiences: [{ variants: [{ type: "holdout", percentage: 100, paywall: null }] }],
  });
}

export function addPlacement(
  api: SuperwallApi,
  campaignId: string,
  placement: string,
): Promise<Row> {
  return api.post<Row>(`/v2/campaigns/${campaignId}/placements`, {
    event_name: placement,
  });
}

export function rowName(row: Row): string {
  for (const key of ["name", "identifier", "product_identifier", "title", "description", "id"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return String(row.id ?? " - ");
}

export interface HeadlessPaywallRef {
  id: string;
  identifier?: string;
  archived: boolean;
  metadata: Record<string, string>;
}

export interface PushedVersion {
  version: number;
  snapshot_id: string;
  url: string;
}

export interface PromotedVersion {
  version: number;
  url: string;
}

/**
 * Paywalls in an app. `archived: true` returns *only* archived ones — the
 * API filters rather than includes — which binding uses to explain an
 * identifier conflict that would otherwise surface as a raw 409.
 */
export async function listAppPaywalls(
  api: SuperwallApi,
  applicationId: string,
  options: { archived?: boolean } = {},
): Promise<HeadlessPaywallRef[]> {
  const rows = await api.list<Row>(
    `/v2/paywalls?application_id=${encodeURIComponent(applicationId)}` +
      (options.archived ? "&archived=true" : ""),
  );
  return rows.map((row) => {
    const metadata: Record<string, string> = {};
    if (typeof row.metadata === "object" && row.metadata !== null) {
      for (const [key, value] of Object.entries(row.metadata)) {
        if (typeof value === "string") metadata[key] = value;
      }
    }
    return {
      id: String(row.id),
      identifier: typeof row.identifier === "string" ? row.identifier : undefined,
      archived: options.archived === true,
      metadata,
    };
  });
}

export async function createHeadlessPaywall(
  api: SuperwallApi,
  opts: { applicationId: string; name: string; identifier: string },
): Promise<HeadlessPaywallRef> {
  const row = await api.post<Row>("/v2/paywalls", {
    application_id: opts.applicationId,
    name: opts.name,
    identifier: opts.identifier,
  });
  return { id: String(row.id), identifier: opts.identifier, archived: false, metadata: {} };
}

/** Mints an immutable version from a built snapshot. Production untouched. */
export function pushPaywallVersion(
  api: SuperwallApi,
  paywallId: string,
  opts: { html: string; surface?: string },
): Promise<PushedVersion> {
  return api.post<PushedVersion>(`/v2/paywalls/${encodeURIComponent(paywallId)}/versions`, {
    html: opts.html,
    ...(opts.surface ? { surface: opts.surface } : {}),
  });
}

/** Points production at a pushed version (the latest by default). */
export function promotePaywallVersion(
  api: SuperwallApi,
  paywallId: string,
  opts: { version?: number } = {},
): Promise<PromotedVersion> {
  return api.post<PromotedVersion>(`/v2/paywalls/${encodeURIComponent(paywallId)}/promote`, {
    ...(opts.version !== undefined ? { version: opts.version } : {}),
  });
}
