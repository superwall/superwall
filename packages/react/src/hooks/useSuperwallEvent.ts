import * as React from "react";
import type { SuperwallEventMap, SuperwallEventName } from "@superwall/runtime";
import { useSuperwallSession } from "../context";

/**
 * Subscribes to a single incoming SDK event by name, or "message" for every
 * incoming message. The handler identity may change freely; the subscription
 * stays stable.
 *
 * ```tsx
 * useSuperwallEvent("transaction_complete", (message) => { ... })
 * ```
 */
export const useSuperwallEvent = <E extends SuperwallEventName>(
  event: E,
  handler: (payload: SuperwallEventMap[E]) => void,
) => {
  const session = useSuperwallSession();
  const handlerRef = React.useRef(handler);
  handlerRef.current = handler;

  React.useEffect(
    () => session.on(event, (payload) => handlerRef.current(payload)),
    [event, session],
  );
};

/**
 * Game controller input forwarded by the SDK. Requires
 * `gameControllerEnabled: true` in the config.
 */
export const useGameController = (
  handler: (input: SuperwallEventMap["game_controller_input"]) => void,
) => {
  useSuperwallEvent("game_controller_input", handler);
};

/**
 * Hardware back button presses re-routed into the paywall (Android).
 * Requires `reRouteBackButton: true` in the config.
 */
export const useBackButton = (handler: (input: SuperwallEventMap["back_button_input"]) => void) => {
  useSuperwallEvent("back_button_input", handler);
};
