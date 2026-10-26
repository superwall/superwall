import * as React from "react";
import { readTeleportBoot } from "../checkout/teleport/boot";
import { teleportFor } from "../checkout/teleport/flow";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

/**
 * Where a teleport stands, for a paywall that draws its own waiting screen
 * (`teleport.overlay: false`) or reads which product the shopper tapped in
 * the app. See `teleport` in `definePaywall`.
 */
export type UseTeleportResult = {
  /** Whether this paywall is the web half of a teleport, opened in the shopper's browser. */
  onWeb: boolean;
  /** In the app: whether the shopper is in the browser and the purchase is being watched. */
  waiting: boolean;
  /** In the app: whether the waiting screen should be on screen now. */
  waitingScreen: boolean;
  /** On the web: whether the purchase completed and the page should say so. */
  completed: boolean;
  /** The product the shopper tapped in the app: the one in flight, or, on the web, the one to select. */
  productReference?: string;
  /** In the app: the store product the waiting screen may offer instead, once the store priced it. */
  fallback?: string;
  /** In the app: opens the browser again on the same checkout. */
  reopen: () => void;
  /** In the app: gives up on the web checkout; the `purchase()` resolves `abandoned`. */
  cancel: () => void;
  /** In the app: buys `fallback` through the store instead; the `purchase()` resolves with that purchase. */
  payInApp: () => void;
  /** On the web: returns to the app, as going back from the first web route does. */
  returnToApp: () => void;
};

export const useTeleport = (): UseTeleportResult => {
  const session = useSuperwallSession();
  useSuperwallSnapshot();
  const teleporter = teleportFor(session);
  const state = React.useSyncExternalStore(
    teleporter.subscribe,
    teleporter.getState,
    teleporter.getState,
  );
  const fallback = teleporter.fallback();

  return React.useMemo(
    () => ({
      onWeb: readTeleportBoot() !== undefined,
      waiting: state.waiting,
      waitingScreen: state.waitingScreen,
      completed: state.completed,
      ...(state.productReference === undefined ? {} : { productReference: state.productReference }),
      ...(fallback === undefined ? {} : { fallback }),
      reopen: teleporter.reopen,
      cancel: teleporter.cancel,
      payInApp: teleporter.payInApp,
      returnToApp: () => teleporter.returnToApp("closed"),
    }),
    [state, fallback, teleporter],
  );
};
