import type { AppRef } from "../app-store-connect/api/client";
import { ApiError, type SuperwallApi } from "./client";

export type RevenueProvider = "open_revenue" | "revenue_cat";
export const REVENUE_INTEGRATIONS: Record<RevenueProvider | "none", string[]> = {
  open_revenue: ["app_store_connect", "google_play", "stripe"],
  revenue_cat: ["revenue_cat", "stripe"],
  none: ["app_store_connect", "google_play", "stripe", "revenue_cat"],
};

export type AppKeyKind = "api_key" | "purchase_key";

export const KEY_KINDS: AppKeyKind[] = ["api_key", "purchase_key"];

export const KEY_LABEL: Record<AppKeyKind, string> = {
  api_key: "App Store Connect API key",
  purchase_key: "In-App Purchase key",
};

export function keyKind(value: unknown): AppKeyKind | undefined {
  return KEY_KINDS.find((kind) => kind === value);
}

export interface SavedAppKey {
  key_id: string;
  issuer_id: string;
  bundle_id?: string;
  has_private_key: boolean;
}

interface RevenueProviderEvents {
  window_days: number;
  open_revenue: { events: number; last_received_at: string | null };
  revenue_cat: { events: number; last_received_at: string | null };
}

export interface IntegrationsOverview {
  revenue_provider: RevenueProvider | null;
  app_store_connect_configuration: SavedAppKey | null;
  in_app_purchase_configuration: SavedAppKey | null;
  revenue_provider_events?: RevenueProviderEvents;
}

interface KeySource {
  application_id: string;
  name: string;
  key_id: string;
  others_count: number;
}

interface KeySources {
  api_key: KeySource[];
  purchase_key: KeySource[];
}

interface KeyCopyResult {
  kind: AppKeyKind;
  valid: boolean;
  error: string | null;
  unconfirmed: string | null;
}

export interface KeyImportResult {
  kind: AppKeyKind;
  status: "imported" | "already_saved" | "not_found";
  key_id: string | null;
  source_name: string | null;
  source_application_id: string | null;
  tried: number;
  timed_out: boolean;
}

type NotificationOwner = "this_app" | "superwall_app" | "other" | "none";

export interface NotificationEnvironment {
  owner: NotificationOwner;
  url: string | null;
  token_redacted: boolean;
  application: { id: number; name: string } | null;
}

export interface ServerNotifications {
  url: string;
  status: "set" | "already_set" | "not_set" | "conflict" | "skipped" | "failed";
  message: string | null;
  retryable: boolean;
  production: NotificationEnvironment | null;
  sandbox: NotificationEnvironment | null;
}

export interface BundleIdCandidate {
  bundle_id: string;
  production_devices: number;
  sandbox_devices: number;
  last_seen_at: string;
  top_country: string | null;
}

export interface BundleIdSuggestions {
  window_days: number;
  available: boolean;
  candidates: BundleIdCandidate[];
}

export class RefusedByApi extends Error {}

function integrations(applicationId: string): string {
  return `/internal/v2/applications/${applicationId}/integrations`;
}

async function supported<T>(what: string, api: SuperwallApi, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && !error.envelope) {
      throw new RefusedByApi(
        `The Superwall API at ${api.host} can't ${what} yet. Nothing was changed.`,
      );
    }
    throw error;
  }
}

export function findIntegrations(api: SuperwallApi, applicationId: string): Promise<IntegrationsOverview> {
  return api.get<IntegrationsOverview>(`${integrations(applicationId)}/overview`);
}

export async function replaceRevenueProvider(
  api: SuperwallApi,
  applicationId: string,
  provider: RevenueProvider,
): Promise<RevenueProvider> {
  const res = await api.patch<{ revenue_provider: RevenueProvider }>(
    `${integrations(applicationId)}/revenue-provider`,
    { revenue_provider: provider },
  );
  return res.revenue_provider;
}

export function listKeySources(api: SuperwallApi, applicationId: string): Promise<KeySources> {
  return supported("list the keys on your other apps", api, () => {
    return api.get<KeySources>(`${integrations(applicationId)}/app-store-keys/copy-sources`);
  });
}

export function copyAppKey(
  api: SuperwallApi,
  applicationId: string,
  input: { kind: AppKeyKind; from: string; confirmed: boolean },
): Promise<KeyCopyResult> {
  return supported("copy a key from another app", api, () => {
    return api.post<KeyCopyResult>(`${integrations(applicationId)}/app-store-keys/copy`, {
      kind: input.kind,
      source_application_id: input.from,
      ...(input.confirmed ? { confirmed: true } : {}),
    });
  });
}

export function importAppKey(
  api: SuperwallApi,
  applicationId: string,
  kind: AppKeyKind,
): Promise<KeyImportResult> {
  return supported("import a key your organization already has", api, () => {
    return api.post<KeyImportResult>(`${integrations(applicationId)}/app-store-keys/import`, { kind });
  });
}

export async function removeAppKey(
  api: SuperwallApi,
  applicationId: string,
  kind: AppKeyKind,
): Promise<void> {
  await supported("remove an app's key", api, () => {
    return api.del(`${integrations(applicationId)}/app-store-keys/${kind}`);
  });
}

function serverNotificationsPath(app: AppRef): string {
  return `/v2/projects/${app.projectId}/applications/${app.applicationId}/integrations/app-store-connect/notification-url/apple`;
}

export function checkServerNotifications(api: SuperwallApi, app: AppRef): Promise<ServerNotifications> {
  return supported("read Apple's server notification URLs", api, () => {
    return api.get<ServerNotifications>(serverNotificationsPath(app));
  });
}

export function updateServerNotifications(
  api: SuperwallApi,
  app: AppRef,
  options: { setRevenueProvider: boolean },
): Promise<ServerNotifications> {
  return supported("set Apple's server notification URLs", api, () => {
    return api.put<ServerNotifications>(
      serverNotificationsPath(app),
      options.setRevenueProvider ? { set_revenue_provider: true } : {},
    );
  });
}

export function listBundleIdSuggestions(
  api: SuperwallApi,
  applicationId: string,
): Promise<BundleIdSuggestions> {
  return supported("suggest a bundle ID", api, () => {
    return api.get<BundleIdSuggestions>(`/internal/v2/applications/${applicationId}/bundle-id-suggestions`);
  });
}

export function updateBundleId(
  api: SuperwallApi,
  applicationId: string,
  input: { bundleId: string; appStoreId?: string; replace: boolean },
): Promise<{ bundle_id: string; app_store_id: string | null }> {
  return supported("save a bundle ID", api, () => {
    return api.post<{ bundle_id: string; app_store_id: string | null }>(
      `/internal/v2/applications/${applicationId}/bundle-id`,
      {
        bundle_id: input.bundleId,
        ...(input.appStoreId ? { app_store_id: input.appStoreId } : {}),
        ...(input.replace ? { replace: true } : {}),
      },
    );
  });
}
