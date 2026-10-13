import { ApiError, type SuperwallApi } from "./client";
import type { AppRef } from "./asc";

export type RevenueProvider = "open_revenue" | "revenue_cat";
export type AppKeyKind = "api_key" | "purchase_key";

export interface SavedAppKey {
  key_id: string;
  issuer_id: string;
  bundle_id?: string;
  has_private_key: boolean;
}

export interface RevenueProviderEvents {
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

export interface KeySource {
  application_id: string;
  name: string;
  key_id: string;
  others_count: number;
}

export interface KeySources {
  api_key: KeySource[];
  purchase_key: KeySource[];
}

export interface KeyCopyResult {
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

export interface NotificationOutcome {
  status: "set" | "already_set" | "not_set" | "conflict" | "failed" | "skipped";
  message: string | null;
  production_url: string | null;
  sandbox_url: string | null;
  retryable?: boolean;
}

export class RefusedByApi extends Error {}

const integrations = (applicationId: string): string =>
  `/internal/v2/applications/${applicationId}/integrations`;

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

export function getIntegrations(api: SuperwallApi, applicationId: string): Promise<IntegrationsOverview> {
  return api.get<IntegrationsOverview>(`${integrations(applicationId)}/overview`);
}

export async function setRevenueProvider(
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
  return supported("list the keys on your other apps", api, () =>
    api.get<KeySources>(`${integrations(applicationId)}/app-store-keys/copy-sources`),
  );
}

export function copyAppKey(
  api: SuperwallApi,
  applicationId: string,
  input: { kind: AppKeyKind; from: string; confirmed: boolean },
): Promise<KeyCopyResult> {
  return supported("copy a key from another app", api, () =>
    api.post<KeyCopyResult>(`${integrations(applicationId)}/app-store-keys/copy`, {
      kind: input.kind,
      source_application_id: input.from,
      ...(input.confirmed ? { confirmed: true } : {}),
    }),
  );
}

export function importAppKey(
  api: SuperwallApi,
  applicationId: string,
  kind: AppKeyKind,
): Promise<KeyImportResult> {
  return supported("import a key your organization already has", api, () =>
    api.post<KeyImportResult>(`${integrations(applicationId)}/app-store-keys/import`, { kind }),
  );
}

export async function removeAppKey(
  api: SuperwallApi,
  applicationId: string,
  kind: AppKeyKind,
): Promise<void> {
  await supported("remove an app's key", api, () =>
    api.del(`${integrations(applicationId)}/app-store-keys/${kind}`),
  );
}

const NEEDS_LOGIN = "authenticated user session";

async function notificationStep(
  api: SuperwallApi,
  app: AppRef,
  body: Record<string, unknown>,
): Promise<NotificationOutcome> {
  try {
    const res = await api.post<{ notification_url: NotificationOutcome | null }>(
      "/internal/v2/onboarding/apple-setup/run-step",
      {
        project_id: Number(app.projectId),
        application_id: Number(app.applicationId),
        ...body,
      },
    );
    if (!res.notification_url) {
      throw new RefusedByApi("Superwall didn't say what Apple has for this app. Nothing was changed.");
    }
    return res.notification_url;
  } catch (error) {
    if (error instanceof ApiError && error.message.includes(NEEDS_LOGIN)) {
      throw new RefusedByApi(
        "Superwall only checks or sets Apple's server notification URL for a signed-in person, not an API key. Run `superwall login`, then try again. Nothing was changed.",
      );
    }
    throw error;
  }
}

export async function checkNotificationUrl(api: SuperwallApi, app: AppRef): Promise<NotificationOutcome> {
  try {
    return await notificationStep(api, app, { step: "check_notification_url" });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || (error.status === 404 && !error.envelope))) {
      throw new RefusedByApi(
        `The Superwall API at ${api.host} can't check Apple's server notification URL yet, so the CLI won't set it either. Nothing was changed. Set it in the dashboard or in App Store Connect.`,
      );
    }
    throw error;
  }
}

export function writeNotificationUrl(
  api: SuperwallApi,
  app: AppRef,
  options: { setRevenueProvider: boolean },
): Promise<NotificationOutcome> {
  return notificationStep(api, app, {
    step: "notification_url",
    ...(options.setRevenueProvider ? { set_revenue_provider: true } : {}),
  });
}
