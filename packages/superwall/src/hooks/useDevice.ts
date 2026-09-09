import * as React from "react";
import type { SuperwallDeviceVariables } from "@superwall/runtime";
import { useMediaQuery } from "./useMediaQuery";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseDeviceResult = SuperwallDeviceVariables & {
  /** Live viewport orientation, derived in the page rather than reported by the host. */
  orientation: "portrait" | "landscape";
};

/** The host's device variables (platform, locale, osVersion, …) plus live `orientation`. */
export const useDevice = (): UseDeviceResult => {
  const { device } = useSuperwallSnapshot();
  const landscape = useMediaQuery("(orientation: landscape)");

  return React.useMemo(
    () => ({ ...device, orientation: landscape ? "landscape" : "portrait" }),
    [device, landscape],
  );
};
