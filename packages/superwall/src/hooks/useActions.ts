import * as React from "react";
import type { SuperwallSession } from "@superwall/runtime";
import { teleportFor } from "../checkout/teleport/flow";
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
> & {
  /** @deprecated Use `useUserAttribute(key, parser)`: typed, re-renders, and reads back the same way. */
  setUserAttributes: SuperwallSession["setUserAttributes"];
};

export const useActions = (): UseActionsResult => {
  const session = useSuperwallSession();

  return React.useMemo(
    () => ({
      close: () => {
        const teleporter = teleportFor(session);
        if (teleporter.kind === "page") teleporter.returnToApp("closed");
        else session.close();
      },
      restore: session.restore.bind(session),
      openUrl: session.openUrl.bind(session),
      openExternalUrl: session.openExternalUrl.bind(session),
      openDeepLink: session.openDeepLink.bind(session),
      customPlacement: session.customPlacement.bind(session),
      setUserAttributes: session.setUserAttributes.bind(session),
      requestPermission: session.requestPermission.bind(session),
      requestCallback: session.requestCallback.bind(session),
      requestStoreReview: session.requestStoreReview.bind(session),
    }),
    [session],
  );
};
