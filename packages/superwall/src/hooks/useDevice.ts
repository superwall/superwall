import * as React from "react";
import type { SuperwallDeviceVariables } from "@superwall/runtime";
import { cutoutOf, modelOf, platformOf, type DeviceCutout, type DevicePlatform } from "../device";
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
  /**
   * What the screen's top edge holds on an iPhone: `"island"`, `"notch"`,
   * `"none"`, or `"strip"` for iPhone Duo, whose camera strip sits on the right
   * when closed or landscape and on top when open in portrait. `undefined` off
   * iPhone. Lay out with the `--sw-safe-area-inset-*` variables rather than
   * this; use it only for a design choice the insets cannot make.
   */
  cutout: DeviceCutout | undefined;
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
      cutout: cutoutOf(modelOf(device)),
    }),
    [device, landscape],
  );
};
export type { DeviceCutout, DevicePlatform } from "../device";
