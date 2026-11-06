// Generated from packages/artifact-sdk by its vendor script. Do not edit.

// src/wire.ts
var CONTEXT_HEADER = "x-superwall-artifact-context";
var ENTRYPOINT_HEADER = "x-superwall-artifact-entrypoint";
var TRIGGER_HEADER = "x-superwall-artifact-trigger";
var PLATFORM_HOST = "platform.artifact.internal";
var API_HOST = "api.artifact.internal";
var INTERNAL_PATH_PREFIX = "/__sw/";
var isInternalPath = (pathname) => {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const path = decoded.toLowerCase().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return path === "/__sw" || path.startsWith(INTERNAL_PATH_PREFIX);
};
var BRIDGE_PROTOCOL = "superwall-artifact@1";
var MOUNT_LOAD_TIMEOUT_MS = 2e4;
var DASHBOARD_ORIGINS = [
  "https://superwall.com",
  "https://app.superwall.com",
  "https://superwall.dev",
  "https://app.superwall.dev"
];
var ARTIFACT_COMPATIBILITY_DATE = "2026-09-01";
var CLIENT_ASSET_PREFIX = "/_client/";
var CLIENT_BUNDLE_MODULE = "@superwall/artifact-sdk/client-bundle";
var CLIENT_ESBUILD_VERSION = "0.28.2";
var CLIENT_BUNDLE_MAX_BYTES = 8 * 1024 * 1024;
var METRIC_LIMITS = {
  /** Points across every series. */
  maxPoints: 5e3,
  /** Distinct breakdown values, `null` included. */
  maxSeries: 50,
  /** The serialized series. */
  maxBytes: 262144,
  /** How long the platform waits for the handler. */
  timeoutMs: 1e4
};
var READOUT_LIMITS = {
  /** The serialized answer. */
  maxBytes: 32768,
  /** How long the platform waits for the handler. */
  timeoutMs: 1e4
};
export {
  API_HOST,
  ARTIFACT_COMPATIBILITY_DATE,
  BRIDGE_PROTOCOL,
  CLIENT_ASSET_PREFIX,
  CLIENT_BUNDLE_MAX_BYTES,
  CLIENT_BUNDLE_MODULE,
  CLIENT_ESBUILD_VERSION,
  CONTEXT_HEADER,
  DASHBOARD_ORIGINS,
  ENTRYPOINT_HEADER,
  INTERNAL_PATH_PREFIX,
  METRIC_LIMITS,
  MOUNT_LOAD_TIMEOUT_MS,
  PLATFORM_HOST,
  READOUT_LIMITS,
  TRIGGER_HEADER,
  isInternalPath
};
