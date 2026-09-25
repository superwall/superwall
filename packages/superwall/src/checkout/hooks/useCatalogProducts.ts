import * as React from "react";
import {
  catalogProductVariables,
  productIdFor,
  type SuperwallCatalogProduct,
  type SuperwallConfig,
  type SuperwallSuppliedProduct,
} from "@superwall/runtime";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { field } from "../api/decode";
import { fetchWithRetry } from "../api/fetch";
import { subscriptionsApiUrl } from "../api/url";
import { hostedInWebSdk } from "../host/surface";
import { isStripeProductIdentifier } from "../products";

const stripeSlotsOf = (config: SuperwallConfig | undefined): Array<[string, string]> =>
  Object.entries(config?.products ?? {}).flatMap(([reference, slot]) => {
    const productId = productIdFor(slot, "web");
    return productId !== undefined && isStripeProductIdentifier(productId)
      ? [[reference, productId]]
      : [];
  });

export const suppliedProductsFrom = (
  config: SuperwallConfig | undefined,
  catalog: readonly SuperwallCatalogProduct[],
): SuperwallSuppliedProduct[] =>
  stripeSlotsOf(config).flatMap(([reference, productId]) => {
    const product = catalog.find((entry) => entry.identifier === productId);
    return product ? [{ reference, productId, variables: catalogProductVariables(product) }] : [];
  });

const readCatalog = async (publicApiKey: string): Promise<SuperwallCatalogProduct[]> => {
  const response = await fetchWithRetry(subscriptionsApiUrl("products"), {
    headers: { Authorization: `Bearer ${publicApiKey}` },
  });
  const data = field(await response.json(), "data");
  return Array.isArray(data) ? (data as SuperwallCatalogProduct[]) : [];
};

/**
 * A native SDK prices every product from its store and sends the variables in
 * `template_variables`. The Web SDK has no store and sends none, so inside it
 * the paywall reads its Stripe prices from Superwall's catalog — the public
 * `products` list, keyed by the application's public API key — and supplies
 * the products it declares itself. Variables a host did send are never
 * replaced.
 */
export const useCatalogProducts = () => {
  const session = useSuperwallSession();
  const { device, config } = useSuperwallSnapshot();
  const publicApiKey = typeof device.publicApiKey === "string" ? device.publicApiKey : "";
  const asked = React.useRef(false);

  React.useEffect(() => {
    if (asked.current || !publicApiKey || !hostedInWebSdk()) return;
    if (stripeSlotsOf(config).length === 0) return;
    asked.current = true;
    readCatalog(publicApiKey)
      .then((catalog) => session.supplyProducts(suppliedProductsFrom(config, catalog)))
      .catch((error: unknown) => {
        console.error("Reading the product catalog failed:", error);
      });
  }, [session, config, publicApiKey]);
};
