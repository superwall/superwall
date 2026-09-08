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
>;

/**
 * Paywall actions dispatched to the native SDK: `close`, `restore`,
 * `openUrl`/`openExternalUrl`/`openDeepLink`, `customPlacement`,
 * permissions, callbacks, and store review. Haptics live in `useHaptics`.
 *
 * `restore()` has no result to await: what the SDK reports lands on
 * `useSuperwallSnapshot().restore` and the `restore_*` events (iOS all
 * three, Android `restore_fail` only); success usually surfaces as a
 * dismissed paywall.
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
    }),
    [session],
  );
};
