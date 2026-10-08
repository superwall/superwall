import { ascProxy, ascProxyGet } from "./asc";
import type { SuperwallApi } from "./client";

export interface ServerNotifications {
  production?: string;
  sandbox?: string;
}

export type NotificationPlan =
  | { status: "already-set" }
  | { status: "conflict"; existing: ServerNotifications }
  | { status: "set"; production: boolean; sandbox: boolean };

const FIELDS =
  "subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox";

interface AppResponse {
  data?: { attributes?: Record<string, unknown> };
}

const url = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export async function readServerNotifications(
  api: SuperwallApi,
  teamId: string,
  ascAppId: string,
): Promise<ServerNotifications> {
  const res = await ascProxyGet<AppResponse>(
    api,
    teamId,
    `/v1/apps/${ascAppId}?fields[apps]=${FIELDS}`,
  );
  const attributes = res.data?.attributes ?? {};
  return {
    production: url(attributes.subscriptionStatusUrl),
    sandbox: url(attributes.subscriptionStatusUrlForSandbox),
  };
}

export function planServerNotifications(
  existing: ServerNotifications,
  wanted: string,
): NotificationPlan {
  const foreign = [existing.production, existing.sandbox].some(
    (value) => value !== undefined && value !== wanted,
  );
  if (foreign) return { status: "conflict", existing };
  const production = existing.production === undefined;
  const sandbox = existing.sandbox === undefined;
  return production || sandbox ? { status: "set", production, sandbox } : { status: "already-set" };
}

export async function setServerNotifications(
  api: SuperwallApi,
  teamId: string,
  ascAppId: string,
  wanted: string,
  plan: { production: boolean; sandbox: boolean },
): Promise<void> {
  await ascProxy(api, teamId, "PATCH", `/v1/apps/${ascAppId}`, {
    data: {
      type: "apps",
      id: ascAppId,
      attributes: {
        ...(plan.production
          ? { subscriptionStatusUrl: wanted, subscriptionStatusUrlVersion: "V2" }
          : {}),
        ...(plan.sandbox
          ? {
              subscriptionStatusUrlForSandbox: wanted,
              subscriptionStatusUrlVersionForSandbox: "V2",
            }
          : {}),
      },
    },
  });
}
