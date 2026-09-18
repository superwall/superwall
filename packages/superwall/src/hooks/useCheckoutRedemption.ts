import * as React from "react";
import { useSuperwallSession } from "../provider/context";
import { completedWebCheckout, resolveCompletedWebCheckout } from "../checkout/redemption";

export type UseCheckoutRedemptionResult = {
  /**
   * True once a `postPurchase: "stay"` web checkout has completed and handed
   * control back to the paywall. Show your success UI, then finish with one
   * of the actions below.
   */
  completed: boolean;
  /** The redemption page URL, when the purchase produced one. */
  redemptionUrl?: string;
  /** A deep link into the app, when the app is installed and offered one. */
  appLink?: string;
  /**
   * Open the app through `appLink` (the editor's "redeem as deep link").
   * Does nothing when there is no link — check `appLink` to decide whether
   * to show the button.
   */
  openApp: () => void;
  /**
   * Send the shopper to redeem: opens the redemption page (or the app deep
   * link if there is one). Resolves once the host has been told where to go.
   */
  redeem: () => Promise<void>;
  /** Redirect the shopper to a URL of your own, with the redemption code attached. */
  redirect: (url: string) => Promise<void>;
  /**
   * Finish the purchase the way the paywall's stored behavior says (redeem
   * on a hosted page, redirect where configured) — what would have happened
   * had the paywall not asked to stay.
   */
  finish: () => Promise<void>;
};

/**
 * Finish a web checkout the paywall chose to keep (`postPurchase: "stay"`).
 * Until `completed` flips there is nothing to do; once it does, render your
 * own success screen and call `redeem()` (or `redirect(url)`) when the shopper
 * taps continue. On any other `postPurchase` the host finishes the purchase
 * itself and `completed` stays false.
 */
export const useCheckoutRedemption = (): UseCheckoutRedemptionResult => {
  const session = useSuperwallSession();
  const completed = React.useSyncExternalStore(
    completedWebCheckout.subscribe,
    completedWebCheckout.get,
    () => undefined,
  );

  const redeem = React.useCallback(
    () => resolveCompletedWebCheckout(session, { type: "redeem" }),
    [session],
  );
  const redirect = React.useCallback(
    (url: string) => resolveCompletedWebCheckout(session, { type: "redirect", url }),
    [session],
  );
  const finish = React.useCallback(
    () => resolveCompletedWebCheckout(session, { type: "default" }),
    [session],
  );
  const appLink = completed?.deepLinkUrl;
  const openApp = React.useCallback(() => {
    if (appLink) session.openDeepLink(appLink);
  }, [session, appLink]);

  return React.useMemo(
    () => ({
      completed: completed !== undefined,
      redemptionUrl: completed?.redemptionUrl,
      appLink,
      redeem,
      redirect,
      finish,
      openApp,
    }),
    [completed, appLink, redeem, redirect, finish, openApp],
  );
};
