import * as React from "react";
import type { SuperwallSession } from "@superwall/runtime";
import { teleportFor } from "../checkout/teleport/flow";
import { useSuperwallSession } from "../provider/context";
import type { TeleportReturnResult } from "./useTeleport";

export type UseActionsResult = Pick<
  SuperwallSession,
  | "restore"
  | "openUrl"
  | "openExternalUrl"
  | "openDeepLink"
  | "customAction"
  | "customPlacement"
  | "requestPermission"
  | "requestCallback"
  | "requestStoreReview"
> & {
  /**
   * Closes the paywall. On a teleport's web half it returns to the app
   * instead and resolves how that went, as `useTeleport().returnToApp()`
   * does; elsewhere it returns `undefined`.
   */
  close: () => Promise<TeleportReturnResult> | undefined;
  /** @deprecated Use `useUserAttribute(key, parser)`: typed, re-renders, and reads back the same way. */
  setUserAttributes: SuperwallSession["setUserAttributes"];
};

export const useActions = (): UseActionsResult => {
  const session = useSuperwallSession();

  return React.useMemo(
    () => ({
      close: () => {
        const teleporter = teleportFor(session);
        if (teleporter.kind === "page") return teleporter.returnToApp("closed");
        session.close();
        return undefined;
      },
      restore: session.restore.bind(session),
      openUrl: session.openUrl.bind(session),
      openExternalUrl: session.openExternalUrl.bind(session),
      openDeepLink: session.openDeepLink.bind(session),
      customAction: session.customAction.bind(session),
      customPlacement: session.customPlacement.bind(session),
      setUserAttributes: session.setUserAttributes.bind(session),
      requestPermission: session.requestPermission.bind(session),
      requestCallback: session.requestCallback.bind(session),
      requestStoreReview: session.requestStoreReview.bind(session),
    }),
    [session],
  );
};
