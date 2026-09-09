import type { SuperwallApi } from "./client";
import type { Row } from "./resources";

export interface AscCredentials {
  keyId: string;
  issuerId: string;
  /** PKCS#8 PEM contents of the ASC .p8 key. */
  privateKey: string;
  accountName?: string;
}

function ascBase(api: SuperwallApi): string {
  const orgId = api.org.id;
  if (!orgId)
    throw new Error("No organization selected - run `superwall orgs use <id|name>` first.");
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

export function deleteAscConfig(api: SuperwallApi, teamId: string): Promise<{ success: boolean }> {
  return api.del<{ success: boolean }>(`${ascBase(api)}/${teamId}`);
}

// Superwall's proxy signs each request with the org's stored ASC key, so no local .p8/JWT signing.
export function ascProxy<T>(
  api: SuperwallApi,
  teamId: string,
  method: string,
  ascPath: string,
  body?: unknown,
): Promise<T> {
  const path = `${ascBase(api)}/proxy/${teamId}${ascPath}`;
  switch (method.toUpperCase()) {
    case "GET":
      return api.get<T>(path);
    case "POST":
      return api.post<T>(path, body ?? {});
    case "PATCH":
      return api.patch<T>(path, body ?? {});
    case "DELETE":
      return api.del<T>(path);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

export function ascProxyGet<T>(api: SuperwallApi, teamId: string, ascPath: string): Promise<T> {
  return ascProxy<T>(api, teamId, "GET", ascPath);
}
