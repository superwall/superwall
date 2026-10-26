import * as React from "react";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { autoPrefetchTargets, prefetchSession } from "../flow";
import { checkoutModeFor } from "../host/sdk";

export const useAutoPrefetch = () => {
  const session = useSuperwallSession();
  const snapshot = useSuperwallSnapshot();
  const mode = checkoutModeFor(snapshot);
  const ran = React.useRef(false);

  const publicApiKey = snapshot.device.publicApiKey;

  React.useEffect(() => {
    if (ran.current) return;
    if (mode !== "sheet" && mode !== "applePay") return;
    if (!publicApiKey) return;
    const targets = autoPrefetchTargets(session, mode);
    if (targets.length === 0) return;
    ran.current = true;
    for (const reference of targets) {
      void prefetchSession(session, reference, mode);
    }
  }, [session, snapshot.products, mode, publicApiKey]);
};
