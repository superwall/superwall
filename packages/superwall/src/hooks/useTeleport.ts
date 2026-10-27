import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import { isStripeProductIdentifier } from "../checkout/products";
import { flowQuery, teleportFor } from "../checkout/teleport/flow";
import { QueryStoreContext } from "../navigation/query";
import type { RouteName } from "../navigation/index";
import { useSuperwallSession } from "../provider/context";
import type { ProductReference, StripeProductReference } from "./index";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

/** Nothing is teleporting: the paywall is in the app with the shopper, or is not a teleport page. */
export type TeleportIdle = {
  /** Always `"idle"`. */
  status: "idle";
};

/**
 * In the app: the shopper is in the browser and the purchase is being
 * watched. It turns on exactly when Superwall's teleport screen would go up:
 * once the app is in the background, after a moment if it never is, or when
 * the SDK asks just before it opens the browser. It turns off when the
 * shopper comes back or the purchase settles.
 */
export type TeleportWaiting = {
  /** Always `"waiting"`. */
  status: "waiting";
  /** The Stripe product being bought in the browser; absent for a teleported push. */
  productReference?: StripeProductReference;
  /** The store product `teleport.fallbacks` offers instead, once the store has priced it. Buy it with `purchase()`. */
  fallbackReference?: ProductReference;
};

/** On the web: the paywall opened in the browser from a teleport, not paid yet. */
export type TeleportArrived = {
  /** Always `"arrived"`. */
  status: "arrived";
  /** The product the shopper tapped in the app, to select here; absent for a teleported push. */
  productReference?: StripeProductReference;
};

/** On the web: the shopper paid. The app is credited on its own. */
export type TeleportCompleted = {
  /** Always `"completed"`. */
  status: "completed";
  /** The product the shopper tapped in the app; absent for a teleported push. */
  productReference?: StripeProductReference;
};

/** Where a teleport stands, discriminated by `status`. */
export type TeleportStatus = TeleportIdle | TeleportWaiting | TeleportArrived | TeleportCompleted;

/** What a paywall can do with a teleport. Each one is a no-op where it doesn't apply. */
export type TeleportActions = {
  /**
   * In the app: prepare the teleport to `route` ahead of the tap, so the
   * browser opens at once. A paywall with `teleport.route` prepares that one
   * when it opens; call this for a route reached with
   * `router.push(route, { teleport: true })`. Default route:
   * `teleport.route`.
   */
  prefetch: (route?: RouteName) => void;
  /** In the app, while `waiting`: opens the browser again on the same checkout. */
  reopen: () => void;
  /** In the app, while `waiting`: gives up on the web checkout; the `purchase()` resolves `abandoned`. */
  cancel: () => void;
  /** On the web: returns to the app, as going back from the first web route does. */
  returnToApp: () => void;
};

/** The result of `useTeleport()`: the status, and the actions. */
export type UseTeleportResult = TeleportStatus & TeleportActions;

type Products = Readonly<Record<string, SuperwallProduct>>;

const isStripeReference = (
  products: Products,
  reference: string | undefined,
): reference is StripeProductReference =>
  reference !== undefined && isStripeProductIdentifier(products[reference]?.productId);

const isProductReference = (
  products: Products,
  reference: string | undefined,
): reference is ProductReference => reference !== undefined && products[reference] !== undefined;

const statusOf = (
  internal: ReturnType<ReturnType<typeof teleportFor>["getStatus"]>,
  fallback: string | undefined,
  products: Products,
): TeleportStatus => {
  if (internal.status === "idle") return internal;
  const product = isStripeReference(products, internal.productReference)
    ? { productReference: internal.productReference }
    : {};
  if (internal.status !== "waiting") return { status: internal.status, ...product };
  return {
    status: "waiting",
    ...product,
    ...(isProductReference(products, fallback) ? { fallbackReference: fallback } : {}),
  };
};

/**
 * Where a teleport stands, for a paywall that draws its own teleport screen
 * (`teleport.overlay: false`), selects the product the shopper tapped in the
 * app, or prepares a teleport ahead of `router.push(route, { teleport: true })`.
 * See `teleport` in `definePaywall`.
 */
export const useTeleport = (): UseTeleportResult => {
  const session = useSuperwallSession();
  const store = React.useContext(QueryStoreContext);
  const { productsByReference } = useSuperwallSnapshot();
  const teleporter = teleportFor(session);
  const status = React.useSyncExternalStore(
    teleporter.subscribe,
    teleporter.getStatus,
    teleporter.getStatus,
  );
  const fallbackReference = teleporter.fallback();

  return React.useMemo(
    () => ({
      ...statusOf(status, fallbackReference, productsByReference),
      prefetch: (route?: RouteName) => teleporter.prefetch(route, flowQuery(store)),
      reopen: teleporter.reopen,
      cancel: teleporter.cancel,
      returnToApp: () => teleporter.returnToApp("closed"),
    }),
    [status, fallbackReference, productsByReference, teleporter, store],
  );
};
