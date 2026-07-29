import type { SuperwallProduct, SuperwallProductVariables } from "@superwall/runtime";
import { SuperwallProvider, useSuperwallSession } from "./context";
import { useActions } from "../hooks/useActions";
import { useDevice } from "../hooks/useDevice";
import { useProducts } from "../hooks/useProducts";
import { usePurchase } from "../hooks/usePurchase";
import { useBackButton, useGameController, useSuperwallEvent } from "../hooks/useSuperwallEvent";
import { useSuperwallSnapshot } from "../hooks/useSuperwallSnapshot";
import { useTranslation } from "../hooks/useTranslation";
import { useTrialEligibility } from "../hooks/useTrialEligibility";
import { useVariables } from "../hooks/useVariables";

export const createSuperwall = <
  TCustomVariables extends Record<string, unknown> = Record<string, unknown>,
>() => {
  type TVariables = TCustomVariables & SuperwallProductVariables;

  return {
    SuperwallProvider,
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
