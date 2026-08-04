import * as React from "react";
import { checkoutModeOf, checkoutPrefetchOf } from "@superwall/runtime";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { controllerFor, prefetchSession } from "../services/registry";
import { APPLE_PAY_PREFETCH_LIMIT } from "../utils/constants";

export const useAutoPrefetch = () => {
  const session = useSuperwallSession();
  const snapshot = useSuperwallSnapshot();
  const mode = checkoutModeOf(snapshot.config?.checkout);
  const configured = checkoutPrefetchOf(snapshot.config?.checkout);
  const ran = React.useRef(false);

  const publicApiKey = snapshot.device.publicApiKey;

  React.useEffect(() => {
    if (ran.current) return;
    if (configured === false) return;
    if (mode !== "sheet" && mode !== "applePay") return;
    if (!publicApiKey) return;
    const controller = controllerFor(session);
    const stripeReferences = snapshot.products
      .map((product) => product.reference)
      .filter((reference) => controller.isStripeProduct(reference));
    if (stripeReferences.length === 0) return;
    ran.current = true;

    const preferred =
      typeof configured === "string" && stripeReferences.includes(configured)
        ? configured
        : (stripeReferences[0] as string);
    const targets =
      mode === "applePay"
        ? [preferred, ...stripeReferences.filter((reference) => reference !== preferred)].slice(
            0,
            APPLE_PAY_PREFETCH_LIMIT,
          )
        : [preferred];
    for (const reference of targets) {
      void prefetchSession(controller, reference, mode);
    }
  }, [session, snapshot.products, mode, configured, publicApiKey]);
};
