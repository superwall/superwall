import { decodeBase64Utf8 } from "@superwall/runtime";
import { asString, field } from "../api/decode";

export type WebSdkInit = {
  apiBase: string;
  placementSessionToken: string;
  presentedByEventName?: string;
  presentedByEventId?: string;
  hostedBySdk?: boolean;
};

export const webSdkInit = (hash: string = window.location.hash): WebSdkInit | null => {
  if (!hash.startsWith("#init=")) return null;
  try {
    const payload: unknown = JSON.parse(decodeBase64Utf8(hash.slice("#init=".length)));
    const apiBase = asString(field(payload, "apiBase"));
    const placementSessionToken = asString(field(payload, "placementSessionToken"));
    if (!apiBase || !placementSessionToken) return null;
    const presentment = field(field(payload, "checkoutContext"), "presentment");
    const presentedByEventName = asString(field(presentment, "presentedByEventName"));
    const presentedByEventId = asString(field(presentment, "presentedByEventId"));
    return {
      apiBase,
      placementSessionToken,
      ...(presentedByEventName ? { presentedByEventName } : {}),
      ...(presentedByEventId ? { presentedByEventId } : {}),
      ...(field(payload, "hostsFrameworkPaywalls") === true ? { hostedBySdk: true } : {}),
    };
  } catch {
    return null;
  }
};

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

export const presentingPlacement = (
  params: Record<string, unknown>,
): { name: string; eventId: string } => {
  const init = webSdkInit();
  return {
    name: textOf(params.event_name) || init?.presentedByEventName || "",
    eventId: asString(params.event_id) || init?.presentedByEventId || "",
  };
};
