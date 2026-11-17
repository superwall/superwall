import * as React from "react";
import { useSuperwallSession } from "../../provider/context";
import { startApplePayCardCheck } from "../applePay/card";
import { followTeleportPage } from "../flow";
import { teleportFor } from "./flow";
import { watchTeleportPageTiming } from "./timing";

/**
 * Superwall's own teleport screens and the wiring behind them: the screen
 * over the paywall in the app while the shopper is in the browser, and
 * "You're all set" on the web once they paid. The build mounts it for a
 * paywall with `teleport`; a paywall drawing its own sets
 * `teleport.overlay: false` and reads `useTeleport()`. It asks Apple whether
 * a card is set up as the paywall opens, so `useApplePay().card` is usually
 * known before the first tap.
 */
export const TeleportScreen = () => {
  const session = useSuperwallSession();
  React.useEffect(() => startApplePayCardCheck(), []);
  React.useEffect(() => watchTeleportPageTiming(), []);
  React.useEffect(() => teleportFor(session).attach(session), [session]);
  React.useEffect(() => followTeleportPage(session), [session]);
  return null;
};
