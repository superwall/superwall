import { decodeBase64Utf8 } from "@superwall/runtime";
import { asString, field } from "../api/decode";

export type WebSdkInit = { apiBase: string; placementSessionToken: string };

export const webSdkInit = (hash: string = window.location.hash): WebSdkInit | null => {
  if (!hash.startsWith("#init=")) return null;
  try {
    const payload: unknown = JSON.parse(decodeBase64Utf8(hash.slice("#init=".length)));
    const apiBase = asString(field(payload, "apiBase"));
    const placementSessionToken = asString(field(payload, "placementSessionToken"));
    return apiBase && placementSessionToken ? { apiBase, placementSessionToken } : null;
  } catch {
    return null;
  }
};
