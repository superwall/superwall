import * as React from "react";
import type { SuperwallDeviceVariables } from "@superwall/runtime";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseDeviceResult = SuperwallDeviceVariables & {
  /** Live viewport orientation (derived client-side, not an SDK variable). */
  orientation: "portrait" | "landscape";
};

const landscapeQuery = "(orientation: landscape)";

const subscribeToOrientation = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mediaQueryList = window.matchMedia(landscapeQuery);
  mediaQueryList.addEventListener("change", onChange);
  return () => mediaQueryList.removeEventListener("change", onChange);
};

const getIsLandscape = () =>
  typeof window !== "undefined" && !!window.matchMedia?.(landscapeQuery).matches;

/**
 * Device variables from the SDK (platform, locale, osVersion, appVersion,
 * isSandbox, …) plus live viewport `orientation`.
 *
 * ```tsx
 * const { platform, locale, orientation } = useDevice()
 * ```
 */
export const useDevice = (): UseDeviceResult => {
  const snapshot = useSuperwallSnapshot();
  const isLandscape = React.useSyncExternalStore(
    subscribeToOrientation,
    getIsLandscape,
    () => false,
  );

  return React.useMemo(
    () => ({
      ...snapshot.device,
      orientation: isLandscape ? ("landscape" as const) : ("portrait" as const),
    }),
    [snapshot.device, isLandscape],
  );
};
