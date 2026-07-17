import * as React from "react";
import type { SuperwallProduct, SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { useSuperwallSession } from "../context";

/**
 * Advanced: the raw, immutable runtime snapshot (products, variables, trial
 * state, message log, …). Prefer the specialized hooks.
 */
export const useSuperwallSnapshot = <
  TProduct extends SuperwallProduct = SuperwallProduct,
>(): SuperwallRuntimeSnapshot<TProduct> => {
  const session = useSuperwallSession<TProduct>();

  return React.useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
};
