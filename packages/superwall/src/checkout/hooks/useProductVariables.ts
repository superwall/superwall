import * as React from "react";
import {
  productIdFor,
  type SuperwallConfig,
  type SuperwallSuppliedProduct,
} from "@superwall/runtime";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { field } from "../api/decode";
import { webSdkInit, type WebSdkInit } from "../host/init";
import { hostedInWebSdk } from "../host/surface";
import { isStripeProductIdentifier } from "../products";

const storeIdentifierOf = (productId: string) => `stripe|${productId}`;

const stripeSlotsOf = (config: SuperwallConfig | undefined): Array<[string, string]> =>
  Object.entries(config?.products ?? {}).flatMap(([reference, slot]) => {
    const productId = productIdFor(slot, "web");
    return productId !== undefined && isStripeProductIdentifier(productId)
      ? [[reference, productId]]
      : [];
  });

/**
 * The same call paywall.js makes when the Web SDK asks it to
 * (`resolveVariables`): `POST {apiBase}/api/products/variables` with the
 * store-prefixed product ids, authorized by the placement session token.
 * The server answers every product variable (price, periods, trial,
 * locale) keyed by that id.
 */
export const resolveProductVariables = async (
  init: WebSdkInit,
  config: SuperwallConfig | undefined,
): Promise<SuperwallSuppliedProduct[]> => {
  const slots = stripeSlotsOf(config);
  if (slots.length === 0) return [];
  const response = await fetch(`${init.apiBase}/api/products/variables`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${init.placementSessionToken}`,
    },
    body: JSON.stringify({ productIdentifiers: slots.map(([, id]) => storeIdentifierOf(id)) }),
  });
  if (!response.ok) throw new Error(`Resolving product variables failed: ${response.status}`);
  const products = field(await response.json(), "products");
  return slots.flatMap(([reference, productId]) => {
    const variables = field(products, storeIdentifierOf(productId));
    return typeof variables === "object" && variables !== null
      ? [{ reference, productId, variables: variables as SuperwallSuppliedProduct["variables"] }]
      : [];
  });
};

/**
 * A native SDK prices every product from its store and sends the variables in
 * `template_variables`. The Web SDK sends none for a headless paywall, so
 * inside it the paywall resolves its Stripe products' variables itself,
 * exactly as paywall.js does, and supplies them to the session. Variables a
 * host did send are never replaced.
 */
export const useProductVariables = () => {
  const session = useSuperwallSession();
  const { config } = useSuperwallSnapshot();
  const asked = React.useRef(false);

  React.useEffect(() => {
    if (asked.current || !hostedInWebSdk()) return;
    const init = webSdkInit();
    if (!init) return;
    asked.current = true;
    resolveProductVariables(init, config)
      .then((products) => session.supplyProducts(products))
      .catch((error: unknown) => {
        console.warn("Error resolving product variables", error);
      });
  }, [session, config]);
};
