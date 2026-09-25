import { decodeBase64Utf8 } from "@superwall/runtime";
import { asString, field } from "../api/decode";

export type WebSdkInit = { apiBase: string; placementSessionToken: string };

/**
 * The Web SDK hands a framed paywall its context in `#init=<base64 JSON>`,
 * the payload paywall.js boots from. The framework reads only what it needs
 * to resolve product variables the way paywall.js does: `apiBase` and the
 * `placementSessionToken` that authorizes the call.
 */
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
