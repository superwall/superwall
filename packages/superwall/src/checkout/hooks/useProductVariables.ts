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

const CACHE_PREFIX = "sw:product-variables:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cacheKeyOf = (init: WebSdkInit, config: SuperwallConfig | undefined) =>
  `${CACHE_PREFIX}${init.apiBase}|${stripeSlotsOf(config)
    .map(([reference, id]) => `${reference}=${id}`)
    .join(",")}`;

export const readCachedProductVariables = (
  key: string,
  now: number = Date.now(),
): SuperwallSuppliedProduct[] | null => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    const at = field(stored, "at");
    const products = field(stored, "products");
    if (typeof at !== "number" || now - at > CACHE_TTL_MS || !Array.isArray(products)) return null;
    return products as SuperwallSuppliedProduct[];
  } catch {
    return null;
  }
};

const writeCachedProductVariables = (key: string, products: SuperwallSuppliedProduct[]) => {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), products }));
  } catch {}
};

export const useProductVariables = () => {
  const session = useSuperwallSession();
  const { config } = useSuperwallSnapshot();
  const asked = React.useRef(false);

  React.useEffect(() => {
    if (asked.current || !hostedInWebSdk()) return;
    const init = webSdkInit();
    if (!init || init.hostedBySdk) return;
    asked.current = true;
    const key = cacheKeyOf(init, config);
    const cached = readCachedProductVariables(key);
    if (cached) session.supplyProducts(cached);
    resolveProductVariables(init, config)
      .then((products) => {
        if (products.length > 0) writeCachedProductVariables(key, products);
        session.supplyProducts(products);
      })
      .catch((error: unknown) => {
        console.warn("Error resolving product variables", error);
      });
  }, [session, config]);
};
