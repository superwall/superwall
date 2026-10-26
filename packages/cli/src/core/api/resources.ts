import { isRecord } from "@/core/json";
import type { PaywallSettings } from "@/core/paywalls/project/framework";
import { ApiError, ApiUnreachableError, type SuperwallApi } from "./client";
import { listReachableProjects } from "./orgs";

export interface Application {
  id: string | number;
  name?: string;
  platform?: string;
  bundle_id?: string;
  public_api_key?: string;
  apple_url_scheme?: string;
  apple_search_ads_configured?: boolean;
}

export interface Project {
  id: string | number;
  name?: string;
  organization_id?: string | number;
  applications?: Application[];
}

export type Row = Record<string, unknown> & { id?: string | number };

export const RESOURCES = {
  products: "/v2/products",
  campaigns: "/v2/campaigns",
  paywalls: "/v2/paywalls",
  entitlements: "/v2/entitlements",
} as const;

export type ResourceName = keyof typeof RESOURCES | "apps";

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
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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
      return platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "?";
  }
}

export interface Scope {
  projectId: string;
  applicationId?: string;
  projectName?: string;
  appName?: string;
}

export async function listProjects(api: SuperwallApi): Promise<Project[]> {
  return listReachableProjects(api);
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
  applicationId?: string;
  name?: string;
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
    ...(opts.applicationId ? { application_id: opts.applicationId } : {}),
    identifier,
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.price ? { price: opts.price } : {}),
    ...(opts.subscription ? { subscription: opts.subscription } : {}),
    ...(opts.entitlements?.length ? { entitlements: opts.entitlements } : {}),
  });
}

export function createProject(
  api: SuperwallApi,
  name: string,
  organizationId: string,
): Promise<Row> {
  return api.post<Row>("/v2/projects", {
    name,
    organization_id: Number(organizationId),
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
  return api.post<Row>("/v2/campaigns", {
    application_id: scope.applicationId,
    description,
    placements: [{ event_name: placement }],
    audiences: [{ variants: [{ type: "holdout", percentage: 100, paywall: null }] }],
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

interface PushedVersion {
  version: number;
  snapshot_id: string;
  url: string;
}

interface PromotedVersion {
  version: number;
  url: string;
}

export async function listAppPaywalls(
  api: SuperwallApi,
  applicationId: string,
  options: { archived?: boolean } = {},
): Promise<HeadlessPaywallRef[]> {
  const rows = await api.list<Row>(
    `/v2/paywalls?application_id=${encodeURIComponent(applicationId)}` +
      (options.archived ? "&archived=true" : ""),
  );
  return rows.map((row) => ({
    id: String(row.id),
    identifier: typeof row.identifier === "string" ? row.identifier : undefined,
    archived: options.archived === true,
    metadata: parseMetadata(row.metadata),
  }));
}

export interface PaywallProductRef {
  reference: string;
  identifier: string;
  store?: string;
}

export interface PaywallDetail extends HeadlessPaywallRef {
  applicationId?: string;
  projectId?: string;
  platform?: string;
  name?: string;
  version?: number;
  url?: string;
  previewUrl?: string;
  headless?: boolean;
  presentationStyle?: string;
  featureGating?: string;
  products: PaywallProductRef[];
}

function parseMetadata(value: unknown): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (!isRecord(value)) return metadata;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") metadata[key] = entry;
  }
  return metadata;
}

function parseProductRefs(value: unknown): PaywallProductRef[] {
  if (!Array.isArray(value)) return [];
  const refs: PaywallProductRef[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    if (typeof row.reference_name !== "string" || typeof row.identifier !== "string") continue;
    refs.push({
      reference: row.reference_name,
      identifier: row.identifier,
      ...(typeof row.store === "string" ? { store: row.store } : {}),
    });
  }
  return refs;
}

export async function findPaywall(api: SuperwallApi, paywallId: string): Promise<PaywallDetail> {
  const row = await api.get<Row>(`/v2/paywalls/${encodeURIComponent(paywallId)}`);
  const applicationId = row.application_id;
  return {
    id: String(row.id ?? paywallId),
    identifier: typeof row.identifier === "string" ? row.identifier : undefined,
    name: typeof row.name === "string" ? row.name : undefined,
    archived: row.archived === true,
    metadata: parseMetadata(row.metadata),
    applicationId:
      typeof applicationId === "string" || typeof applicationId === "number"
        ? String(applicationId)
        : undefined,
    projectId:
      typeof row.project_id === "string" || typeof row.project_id === "number"
        ? String(row.project_id)
        : undefined,
    platform: typeof row.application_platform === "string" ? row.application_platform : undefined,
    version: typeof row.version === "number" ? row.version : undefined,
    url: typeof row.paywall_url === "string" ? row.paywall_url : undefined,
    previewUrl: typeof row.preview_url === "string" ? row.preview_url : undefined,
    headless: row.headless === true,
    presentationStyle:
      typeof row.presentation_style === "string" ? row.presentation_style : undefined,
    featureGating: typeof row.feature_gating === "string" ? row.feature_gating : undefined,
    products: parseProductRefs(row.products),
  };
}

interface LivePaywall {
  version?: number;
  snapshotId?: string;
  products?: PaywallProductRef[];
}

const SNAPSHOT_IN_URL = /([a-f0-9]{64})\.html/;

export async function livePaywall(api: SuperwallApi, paywallId: string): Promise<LivePaywall> {
  return findPaywall(api, paywallId).then(
    (paywall) => ({
      version: paywall.version,
      snapshotId: paywall.url?.match(SNAPSHOT_IN_URL)?.[1],
      products: paywall.products,
    }),
    (error: unknown) => {
      if (error instanceof ApiUnreachableError) return {};
      if (error instanceof ApiError && error.status >= 500) return {};
      throw error;
    },
  );
}

export async function livePaywallVersion(
  api: SuperwallApi,
  paywallId: string,
): Promise<number | undefined> {
  return livePaywall(api, paywallId).then((live) => live.version);
}

export async function createHeadlessPaywall(
  api: SuperwallApi,
  opts: { applicationId: string; name: string; identifier: string },
): Promise<HeadlessPaywallRef> {
  const row = await api.post<Row>("/v2/paywalls", {
    application_id: opts.applicationId,
    name: opts.name,
    identifier: opts.identifier,
    headless: true,
  });
  return { id: String(row.id), identifier: opts.identifier, archived: false, metadata: {} };
}

export type VersionStore = "stripe" | "app-store" | "play-store" | "custom";

export type ProductStores = Record<string, readonly VersionStore[]>;

export interface VersionProduct {
  store: VersionStore;
  identifier: string;
  reference_name: string;
}

export function platformStore(platform: string | undefined): VersionStore {
  return platform === "android" ? "play-store" : "app-store";
}

function resolveStore(
  identifier: string,
  platform: string | undefined,
  known: readonly VersionStore[],
): VersionStore {
  if (/^(test|live):price_[^:]+/.test(identifier)) return "stripe";
  const fallback = platformStore(platform);
  if (known.includes(fallback)) return fallback;
  if (known.includes("custom")) return "custom";
  if (known.includes("stripe")) return "stripe";
  return fallback;
}

export function versionProducts(
  products: Record<string, string> | undefined,
  platform?: string,
  stores: ProductStores = {},
): VersionProduct[] {
  return Object.entries(products ?? {}).map(([reference, identifier]) => {
    return {
      store: resolveStore(
        identifier,
        platform,
        Object.hasOwn(stores, identifier) ? (stores[identifier] ?? []) : [],
      ),
      identifier,
      reference_name: reference,
    };
  });
}

export function pushPaywallVersion(
  api: SuperwallApi,
  paywallId: string,
  opts: {
    html: string;
    surface?: string;
    assets?: VersionAsset[];
    products?: VersionProduct[];
    settings?: PaywallSettings;
    locales?: string[];
  },
): Promise<PushedVersion> {
  return api.post<PushedVersion>(`/v2/paywalls/${encodeURIComponent(paywallId)}/versions`, {
    html: opts.html,
    ...(opts.surface ? { surface: opts.surface } : {}),
    ...(opts.assets && opts.assets.length > 0 ? { assets: opts.assets } : {}),
    ...(opts.products && opts.products.length > 0 ? { products: opts.products } : {}),
    ...(opts.locales && opts.locales.length > 0 ? { locales: opts.locales } : {}),
    ...(opts.settings ?? {}),
  });
}

export interface VersionAsset {
  url: string;
  mime_type: string;
}

export interface AssetManifestEntry {
  sha256: string;
  bytes: number;
  mime: string;
  file_name: string;
}

interface ResolvedAsset {
  sha256: string;
  url: string;
  uploadUrl?: string;
}

const ASSET_MANIFEST_CHUNK = 100;

export async function pushPaywallAssets(
  api: SuperwallApi,
  paywallId: string,
  assets: readonly AssetManifestEntry[],
): Promise<ResolvedAsset[]> {
  const resolved: ResolvedAsset[] = [];

  for (let at = 0; at < assets.length; at += ASSET_MANIFEST_CHUNK) {
    const body = await api.post<Row>(`/v2/paywalls/${encodeURIComponent(paywallId)}/assets`, {
      assets: assets.slice(at, at + ASSET_MANIFEST_CHUNK),
    });
    const rows = body.assets;
    if (!Array.isArray(rows)) {
      throw new Error("The assets endpoint returned no asset list.");
    }
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const sha256 = Reflect.get(row, "sha256");
      const url = Reflect.get(row, "url");
      const uploadUrl = Reflect.get(row, "upload_url");
      if (typeof sha256 !== "string" || typeof url !== "string") continue;
      resolved.push({
        sha256,
        url,
        ...(typeof uploadUrl === "string" ? { uploadUrl } : {}),
      });
    }
  }

  return resolved;
}

interface SourceAccessGrant {
  repo: string;
  remote: string;
  branch: string;
  token: string;
  tokenId: string;
}

export async function mintSourceAccess(
  api: SuperwallApi,
  paywallId: string,
): Promise<SourceAccessGrant> {
  const row = await api.post<Row>(
    `/v2/paywalls/${encodeURIComponent(paywallId)}/source-access`,
    {},
  );
  const text = (key: string): string => {
    const value = row[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`Superwall returned no ${key} for the source repo.`);
    }
    return value;
  };
  return {
    repo: text("repo"),
    remote: text("remote"),
    branch: text("branch"),
    token: text("token"),
    tokenId: text("token_id"),
  };
}

export async function linkSourceCommit(
  api: SuperwallApi,
  paywallId: string,
  version: number,
  opts: { commitSha: string; tokenId?: string },
): Promise<{ commitSha: string }> {
  const row = await api.post<Row>(
    `/v2/paywalls/${encodeURIComponent(paywallId)}/versions/${version}/source-commit`,
    {
      commit_sha: opts.commitSha,
      ...(opts.tokenId ? { token_id: opts.tokenId } : {}),
    },
  );
  return {
    commitSha: typeof row.commit_sha === "string" ? row.commit_sha : opts.commitSha,
  };
}

export function promotePaywallVersion(
  api: SuperwallApi,
  paywallId: string,
  opts: { version?: number } = {},
): Promise<PromotedVersion> {
  return api.post<PromotedVersion>(`/v2/paywalls/${encodeURIComponent(paywallId)}/promote`, {
    ...(opts.version !== undefined ? { version: opts.version } : {}),
  });
}
