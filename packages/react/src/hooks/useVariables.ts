import * as React from "react";
import type {
  SuperwallDeviceVariables,
  SuperwallPlacementParams,
  SuperwallUserVariables,
} from "@superwall/runtime";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

/**
 * User attributes the app set via the native SDK
 * (`Superwall.shared.setUserAttributes`).
 */
export const useUser = (): SuperwallUserVariables => useSuperwallSnapshot().user;

export type UseVariablesResult = {
  /** Device variables from the SDK (platform, locale, osVersion, …). */
  device: SuperwallDeviceVariables;
  /** User attributes the app set via the native SDK. */
  user: SuperwallUserVariables;
  /** Params passed to the placement that presented this paywall. */
  params: SuperwallPlacementParams;
};

/**
 * All SDK variable groups in one hook. Prefer `useDevice` / `useUser` when
 * you only need one group.
 *
 * ```tsx
 * const { device, user, params } = useVariables()
 * ```
 */
export const useVariables = (): UseVariablesResult => {
  const snapshot = useSuperwallSnapshot();

  return React.useMemo(
    () => ({
      device: snapshot.device,
      user: snapshot.user,
      params: snapshot.params,
    }),
    [snapshot.device, snapshot.user, snapshot.params],
  );
};
