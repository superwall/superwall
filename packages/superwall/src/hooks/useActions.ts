import * as React from "react";
import type { SuperwallSession } from "@superwall/runtime";
import { useSuperwallSession } from "../provider/context";

export type UseActionsResult = Pick<
  SuperwallSession,
  | "close"
  | "restore"
  | "openUrl"
  | "openExternalUrl"
  | "openDeepLink"
  | "customPlacement"
  | "requestPermission"
  | "requestCallback"
  | "requestStoreReview"
  | "hapticFeedback"
>;

/**
 * Paywall actions dispatched to the native SDK: `close`, `restore`,
 * `openUrl`/`openExternalUrl`/`openDeepLink`, `customPlacement`,
 * permissions, callbacks, store review, and haptics.
 *
 * `restore()` is fire-and-forget — the message protocol has no
 * restore-result event; successful restores surface as
 * `transaction_complete` or a dismissed paywall.
 */
export const useActions = (): UseActionsResult => {
  const session = useSuperwallSession();

  return React.useMemo(
    () => ({
      close: session.close.bind(session),
      restore: session.restore.bind(session),
      openUrl: session.openUrl.bind(session),
      openExternalUrl: session.openExternalUrl.bind(session),
      openDeepLink: session.openDeepLink.bind(session),
      customPlacement: session.customPlacement.bind(session),
      requestPermission: session.requestPermission.bind(session),
      requestCallback: session.requestCallback.bind(session),
      requestStoreReview: session.requestStoreReview.bind(session),
      hapticFeedback: session.hapticFeedback.bind(session),
    }),
    [session],
  );
};
