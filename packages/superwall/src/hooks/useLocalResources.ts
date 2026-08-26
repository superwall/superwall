import * as React from "react";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export const LOCAL_RESOURCE_SCHEME = "swlocal://";

export const localResourceUrl = (id: string): string => `${LOCAL_RESOURCE_SCHEME}${id}`;

export const parseLocalResourceIds = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

export type UseLocalResourcesResult = {
  ids: readonly string[];
  has: (id: string) => boolean;
  resolve: (id: string, fallback: string) => string;
};

/**
 * Local resources the host app registered (`SuperwallOptions.localResources`
 * on iOS), served by the SDK at `swlocal://<id>` without a network request.
 *
 * ```tsx
 * const { resolve } = useLocalResources();
 * <video src={resolve("hero-video", heroFallback)} />
 * ```
 */
export const useLocalResources = (): UseLocalResourcesResult => {
  const snapshot = useSuperwallSnapshot();
  const reported = snapshot.device.localResourceIds;
  return React.useMemo(() => {
    const ids = parseLocalResourceIds(reported);
    const known = new Set(ids);
    return {
      ids,
      has: (id) => known.has(id),
      resolve: (id, fallback) => (known.has(id) ? localResourceUrl(id) : fallback),
    };
  }, [reported]);
};

/**
 * The URL to load for a local resource: `swlocal://<id>` when the host app
 * registered it, otherwise the bundled or hosted `fallback`.
 *
 * ```tsx
 * import hero from "@/assets/hero.mp4";
 * const src = useLocalResource("hero-video", hero);
 * ```
 */
export const useLocalResource = (id: string, fallback: string): string =>
  useLocalResources().resolve(id, fallback);
