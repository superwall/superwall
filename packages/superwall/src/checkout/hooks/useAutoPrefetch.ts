import * as React from "react";
import { detectSuperwallHost } from "@superwall/runtime";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { warmOnOpen } from "../flow";

const PAGE_LOAD = {};

export const useAutoPrefetch = () => {
  const session = useSuperwallSession();
  const snapshot = useSuperwallSnapshot();
  const open = detectSuperwallHost() ? snapshot.paywall : PAGE_LOAD;

  React.useEffect(() => {
    if (open !== undefined) warmOnOpen(session, open);
  }, [session, open, snapshot.products, snapshot.device.publicApiKey]);
};
