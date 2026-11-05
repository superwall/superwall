export const CONTEXT_HEADER = "x-superwall-workspace-context";
export const ENTRYPOINT_HEADER = "x-superwall-workspace-entrypoint";
export const TRIGGER_HEADER = "x-superwall-workspace-trigger";
export const WORKSPACE_HEADER_PREFIX = "x-superwall-workspace-";
export const API_HOST = "api.workspace.internal";
export const PLATFORM_HOST = "platform.workspace.internal";
export const BRIDGE_PROTOCOL = "superwall-workspace@1";
export const MOUNT_LOAD_TIMEOUT_MS = 20_000;
export const WORKSPACE_COMPATIBILITY_DATE = "2026-09-01";
export const METRIC_LIMITS = { maxPoints: 5_000, maxSeries: 50, maxBytes: 256 * 1024, timeoutMs: 10_000 } as const;
export const READOUT_LIMITS = { maxBytes: 32 * 1024, timeoutMs: 10_000 } as const;
export const DRAFT_MODULE_MAX_BYTES = 1024 * 1024;
export const BUNDLE_MAX_BYTES = 10 * 1024 * 1024;
export const CLIENT_BUNDLE_MODULE = "@superwall/workspace-sdk/client-bundle";

export const isInternalPath = (pathname: string): boolean => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const normalized = decoded.toLowerCase().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return normalized === "/__sw" || normalized.startsWith("/__sw/");
};
