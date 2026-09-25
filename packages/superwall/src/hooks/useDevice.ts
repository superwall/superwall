import * as React from "react";
import type { SuperwallDeviceVariables } from "@superwall/runtime";
import { platformOf, type DevicePlatform } from "../device";
import { useMediaQuery } from "./useMediaQuery";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseDeviceResult = SuperwallDeviceVariables & {
  /** Live viewport orientation, derived in the page rather than reported by the host. */
  orientation: "portrait" | "landscape";
  /**
   * The host SDK's platform, normalized: `"ios"` (also an iPad app on a Mac),
   * `"android"`, `"web"` for the Web SDK, or `undefined` for a host that has
   * not said (the studio, a plain page). Known from the first render. Branch on
   * this, not on the raw `platform` string, whose casing is the host's.
   */
  hostPlatform: DevicePlatform | undefined;
};

/** The host's device variables (platform, locale, osVersion, …) plus live `orientation` and `hostPlatform`. */
export const useDevice = (): UseDeviceResult => {
  const { device } = useSuperwallSnapshot();
  const landscape = useMediaQuery("(orientation: landscape)");

  return React.useMemo(
    () => ({
      ...device,
      orientation: landscape ? "landscape" : "portrait",
      hostPlatform: platformOf(device),
    }),
    [device, landscape],
  );
};
export type { DevicePlatform } from "../device";
