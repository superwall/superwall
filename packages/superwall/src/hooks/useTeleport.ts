import * as React from "react";
import type { SuperwallProduct } from "@superwall/runtime";
import type { CheckoutFailure } from "../checkout/failure";
import { lastWebFailure } from "../checkout/flow";
import { isStripeProductIdentifier } from "../checkout/products";
import { teleportFor } from "../checkout/teleport/flow";
import { flowQuery, type TeleportData } from "../checkout/teleport/teleporter";

export type { TeleportData, TeleportDataValue } from "../checkout/teleport/teleporter";
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
 * the SDK asks just before it opens the browser. It lasts until the purchase
 * settles: once the shopper is back, `returned` turns on while it is checked
 * one last time.
 */
export type TeleportWaiting = {
  /** Always `"waiting"`. */
  status: "waiting";
  /**
   * Whether the shopper came back to the app. It stays `"waiting"` while the
   * purchase is checked once more, for a moment after they return; Superwall's
   * teleport screen hides then and a loader covers the check.
   */
  returned: boolean;
  /** The Stripe product being bought in the browser; absent for a teleported push. */
  productReference?: StripeProductReference;
  /** The store product `teleport.fallbacks` offers instead, once the store has priced it. Buy it with `purchase()`. */
  fallbackReference?: ProductReference;
  /**
   * Why the last payment in the browser failed: what the page left with
   * `returnToApp()` once the shopper is back, or what the backend reports
   * while they are still in the browser. Absent while no payment failed.
   */
  failure?: CheckoutFailure;
  /**
   * What the page passed to `returnToApp({ data })`, once the shopper is back
   * and the app has read it. Absent when the page passed none.
   */
  data?: TeleportData;
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
  /** Whether another checkout of the same presentation was paid, not this page's. */
  paidElsewhere: boolean;
  /** The product the shopper tapped in the app; absent for a teleported push. */
  productReference?: StripeProductReference;
};

/** Where a teleport stands, discriminated by `status`. */
export type TeleportStatus = TeleportIdle | TeleportWaiting | TeleportArrived | TeleportCompleted;

/**
 * How a return to the app went: `"opened"` the app came up, `"cancelled"`
 * the shopper tapped Cancel on iOS's "Open in App?" prompt and is still on
 * the page, `"no_app"` nothing could open it (no app link, or no installed
 * app for its URL scheme).
 */
export type TeleportReturnResult = "opened" | "cancelled" | "no_app";

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
  open: () => void;
  /** In the app, while `waiting`: gives up on the web checkout; the `purchase()` resolves `abandoned`. */
  cancel: () => void;
  /**
   * On the web: returns to the app, as going back from the first web route
   * does, and resolves how that went. After a failed payment the return
   * link carries `reason=failed`, so it can be called from
   * `usePurchase({ onFailure })`. While iOS asks "Open in App?", the page
   * dims with an arrow at Open. In the app it resolves `"opened"` at once.
   *
   * The page leaves the app why the payment failed, and `data` when given:
   * plain JSON, at most 16 KB. The app reads both once the shopper is back,
   * as `failure` and `data` while `waiting`. Nothing is left once the
   * purchase is paid, since the teleport has closed by then.
   */
  returnToApp: (options?: TeleportReturnOptions) => Promise<TeleportReturnResult>;
};

/** What `returnToApp()` hands the app, on the web. */
export type TeleportReturnOptions = {
  /**
   * Plain JSON for the app, read there as `useTeleport().data`. At most 16 KB;
   * over that the page logs a warning and leaves the app only the failure.
   */
  data?: TeleportData;
};

/** What a teleport is doing right now, beside its status. */
export type TeleportActivity = {
  /**
   * On the web: true while a return to the app is under way, from the moment
   * the page hands the shopper to the app until `returnToApp()` resolves.
   * Always `false` in the app.
   */
  returning: boolean;
};

/** The result of `useTeleport()`: the status, and the actions. */
export type UseTeleportResult = TeleportStatus & TeleportActions & TeleportActivity;

/** Callbacks for what happens to a teleport, each optional. */
export type UseTeleportOptions = {
  /** In the app: the browser opened, the first time or again. */
  onOpen?: () => void;
  /** In the app: the shopper came back to the app while the purchase was open. */
  onReturn?: () => void;
  /** In the app: the shopper tapped Cancel, or the paywall called `cancel()`. */
  onCancel?: () => void;
  /** In the app: the web purchase was paid and is being redeemed. */
  onComplete?: () => void;
  /** In the app: the shopper is back and the app read the `data` the page passed to `returnToApp()`. */
  onReturnData?: (data: TeleportData) => void;
};

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

const notReturning = () => false;

const statusOf = (
  internal: ReturnType<ReturnType<typeof teleportFor>["getStatus"]>,
  fallback: string | undefined,
  products: Products,
): TeleportStatus => {
  if (internal.status === "idle") return internal;
  const product = isStripeReference(products, internal.productReference)
    ? { productReference: internal.productReference }
    : {};
  if (internal.status === "arrived") return { status: "arrived", ...product };
  if (internal.status === "completed") {
    return { status: "completed", paidElsewhere: internal.paidElsewhere, ...product };
  }
  return {
    status: "waiting",
    returned: internal.returned,
    ...product,
    ...(isProductReference(products, fallback) ? { fallbackReference: fallback } : {}),
    ...(internal.failure === undefined ? {} : { failure: internal.failure }),
    ...(internal.data === undefined ? {} : { data: internal.data }),
  };
};

/**
 * Where a teleport stands, for a paywall that draws its own teleport screen
 * (`teleport.overlay: false`), selects the product the shopper tapped in the
 * app, or prepares a teleport ahead of `router.push(route, { teleport: true })`.
 * See `teleport` in `definePaywall`.
 */
export const useTeleport = (options: UseTeleportOptions = {}): UseTeleportResult => {
  const session = useSuperwallSession();
  const store = React.useContext(QueryStoreContext);
  const { productsByReference } = useSuperwallSnapshot();
  const teleporter = teleportFor(session);
  const status = React.useSyncExternalStore(
    teleporter.subscribe,
    teleporter.getStatus,
    teleporter.getStatus,
  );
  const isReturning = teleporter.kind === "page" ? teleporter.returning : notReturning;
  const returning = React.useSyncExternalStore(teleporter.subscribe, isReturning, isReturning);
  const fallbackReference = teleporter.kind === "app" ? teleporter.fallback() : undefined;
  const callbacks = React.useRef(options);
  callbacks.current = options;

  React.useEffect(() => {
    const unsubscribers = [
      teleporter.on("open", () => callbacks.current.onOpen?.()),
      teleporter.on("return", () => callbacks.current.onReturn?.()),
      teleporter.on("cancel", () => callbacks.current.onCancel?.()),
      teleporter.on("complete", () => callbacks.current.onComplete?.()),
      teleporter.on("data", () => {
        const current = teleporter.getStatus();
        if (current.status === "waiting" && current.data !== undefined) {
          callbacks.current.onReturnData?.(current.data);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [teleporter]);

  return React.useMemo(
    () => ({
      ...statusOf(status, fallbackReference, productsByReference),
      returning,
      prefetch: (route?: RouteName) => {
        if (teleporter.kind === "app") teleporter.prefetch(route, flowQuery(store));
      },
      open: () => {
        if (teleporter.kind === "app") teleporter.open();
      },
      cancel: () => {
        if (teleporter.kind === "app") teleporter.cancel();
      },
      returnToApp: async (returnOptions?: TeleportReturnOptions): Promise<TeleportReturnResult> => {
        if (teleporter.kind === "page") {
          const failure = lastWebFailure(session)?.failure;
          const data = returnOptions?.data;
          return teleporter.returnToApp(failure ? "failed" : "closed", {
            query: flowQuery(store),
            returned: {
              ...(failure === undefined ? {} : { failure }),
              ...(data === undefined ? {} : { data }),
            },
          });
        }
        teleporter.returnToApp();
        return "opened";
      },
    }),
    [status, returning, fallbackReference, productsByReference, teleporter, store],
  );
};
