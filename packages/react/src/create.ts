import type { SuperwallProduct, SuperwallProductVariables } from "@superwall/runtime";
import { SuperwallProvider, useSuperwallSession } from "./context";
import {
  useActions,
  useBackButton,
  useDevice,
  useGameController,
  useProducts,
  usePurchase,
  useSuperwallEvent,
  useSuperwallSnapshot,
  useTranslation,
  useTrialEligibility,
  useVariables,
} from "./hooks";

/**
 * Binds the whole surface to one custom-variables type, so paywalls declare
 * their extra product variables once instead of threading a generic through
 * every hook. Custom variables EXTEND the SDK's known product variables
 * (price, period, trialPeriodDays, …) — they never replace them.
 *
 * ```tsx
 * export const { SuperwallProvider, useProducts, usePurchase } = createSuperwall<{
 *   badge?: string
 * }>()
 *
 * const { products } = useProducts()
 * products[0].variables.price // still typed
 * products[0].variables.badge // your custom variable, typed
 * ```
 */
export const createSuperwall = <
  TCustomVariables extends Record<string, unknown> = Record<string, unknown>,
>() => {
  type TVariables = TCustomVariables & SuperwallProductVariables;

  return {
    SuperwallProvider: SuperwallProvider<SuperwallProduct<TVariables>>,
    useProducts: () => useProducts<TVariables>(),
    usePurchase: () => usePurchase<TVariables>(),
    useActions,
    useDevice,
    useUser: () => useSuperwallSnapshot().user,
    useVariables,
    useTrialEligibility,
    useTranslation,
    useSuperwallEvent,
    useGameController,
    useBackButton,
    useSuperwallSession: () => useSuperwallSession<SuperwallProduct<TVariables>>(),
    useSuperwallSnapshot: () => useSuperwallSnapshot<SuperwallProduct<TVariables>>(),
  };
};
