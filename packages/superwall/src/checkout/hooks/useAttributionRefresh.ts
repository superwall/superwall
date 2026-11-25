import * as React from "react";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { refreshAttribution } from "../flow";

export const useAttributionRefresh = () => {
  const session = useSuperwallSession();
  const { paywall, experiment } = useSuperwallSnapshot();
  const paywallId = paywall?.id;
  const experimentId = experiment?.experimentId;
  const variantId = experiment?.variantId;

  React.useEffect(() => {
    refreshAttribution(session);
  }, [session, paywallId, experimentId, variantId]);
};
