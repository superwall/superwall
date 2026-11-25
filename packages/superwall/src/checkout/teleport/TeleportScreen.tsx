import * as React from "react";
import { useSuperwallSession } from "../../provider/context";
import { startApplePayCheck } from "../applePay/available";
import { followTeleportPage } from "../flow";
import { teleportFor } from "./flow";
import { afterPaint, watchTeleportPageTiming } from "./timing";

/**
 * Superwall's own teleport screens and the wiring behind them: the screen
 * over the paywall in the app while the shopper is in the browser, and
 * "You're all set" on the web once they paid. The build mounts it for a
 * paywall with `teleport`; a paywall drawing its own sets
 * `teleport.overlay: false` and reads `useTeleport()`. It asks Apple whether
 * Apple Pay is available once the paywall's first frame is on screen, so
 * `useApplePay().available` is usually known before the first tap.
 */
export const TeleportScreen = () => {
  const session = useSuperwallSession();
  React.useEffect(() => watchTeleportPageTiming(), []);
  React.useEffect(() => afterPaint(startApplePayCheck), []);
  React.useEffect(() => teleportFor(session).attach(session), [session]);
  React.useEffect(() => followTeleportPage(session), [session]);
  return null;
};
