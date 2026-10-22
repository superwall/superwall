import type { SuperwallApi } from "@/core/api/client";
import type { Row } from "@/core/api/resources";

interface AscCredentials {
  keyId: string;
  issuerId: string;
  privateKey: string;
  accountName?: string;
}

function ascBase(api: SuperwallApi): string {
  const orgId = api.org.id;
  if (!orgId) throw new Error("App Store Connect needs the app's account - pass --app <id>.");
  return `/v2/organizations/${orgId}/app-store-connect`;
}

export async function listAscConfigs(api: SuperwallApi): Promise<Row[]> {
  const res = await api.get<{ data?: Row[] }>(ascBase(api));
  return res.data ?? [];
}

export function createAscConfig(api: SuperwallApi, c: AscCredentials): Promise<Row> {
  return api.post<Row>(ascBase(api), {
    key_id: c.keyId,
    issuer_id: c.issuerId,
    private_key: c.privateKey,
    ...(c.accountName ? { account_name: c.accountName } : {}),
  });
}

export function replaceAscConfig(api: SuperwallApi, teamId: string, c: AscCredentials): Promise<Row> {
  return api.patch<Row>(`${ascBase(api)}/${teamId}`, {
    key_id: c.keyId,
    issuer_id: c.issuerId,
    private_key: c.privateKey,
    validate: true,
    ...(c.accountName ? { account_name: c.accountName } : {}),
  });
}

export interface AppRef {
  projectId: string;
  applicationId: string;
}

export interface KeyVerdict {
  valid: boolean;
  error: string | null;
}

function appIntegrations(app: AppRef): string {
  return `/v2/projects/${app.projectId}/applications/${app.applicationId}/integrations`;
}

export function replaceAppAscKey(api: SuperwallApi, app: AppRef, c: AscCredentials): Promise<KeyVerdict> {
  return api.put<KeyVerdict>(`${appIntegrations(app)}/app-store-connect/configuration`, {
    key_id: c.keyId,
    issuer_id: c.issuerId,
    private_key: c.privateKey,
  });
}

export function replaceAppPurchaseKey(
  api: SuperwallApi,
  app: AppRef,
  c: AscCredentials & { bundleId: string; setApplicationBundleId?: boolean },
): Promise<KeyVerdict> {
  return api.put<KeyVerdict>(`${appIntegrations(app)}/in-app-purchase/configuration`, {
    bundle_id: c.bundleId,
    key_id: c.keyId,
    issuer_id: c.issuerId,
    private_key: c.privateKey,
    ...(c.setApplicationBundleId ? { set_application_bundle_id: true } : {}),
  });
}

export async function findAppNotificationUrl(api: SuperwallApi, app: AppRef): Promise<string> {
  const res = await api.get<{ url: string }>(
    `${appIntegrations(app)}/app-store-connect/notification-url`,
  );
  return res.url;
}

export function removeAscConfig(api: SuperwallApi, teamId: string): Promise<{ success: boolean }> {
  return api.del<{ success: boolean }>(`${ascBase(api)}/${teamId}`);
}

export function ascProxy<T>(
  api: SuperwallApi,
  teamId: string,
  method: "get" | "post" | "patch" | "delete",
  ascPath: string,
  body?: unknown,
): Promise<T> {
  const path = `${ascBase(api)}/proxy/${teamId}${ascPath}`;
  switch (method) {
    case "get":
      return api.get<T>(path);
    case "post":
      return api.post<T>(path, body ?? {});
    case "patch":
      return api.patch<T>(path, body ?? {});
    case "delete":
      return api.del<T>(path);
  }
}

export function ascProxyGet<T>(api: SuperwallApi, teamId: string, ascPath: string): Promise<T> {
  return ascProxy<T>(api, teamId, "get", ascPath);
}
