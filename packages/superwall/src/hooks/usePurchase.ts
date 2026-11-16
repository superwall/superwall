import * as React from "react";
import type {
  SuperwallProduct,
  SuperwallProductVariables,
  SuperwallPurchaseFailure,
  SuperwallPurchaseOptions,
  SuperwallPurchaseResult,
  SuperwallTransaction,
} from "@superwall/runtime";
import { useSuperwallSession } from "../provider/context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";
import type { ProductReference } from "./index";
import {
  clearWebFailure,
  lastWebFailure,
  prefetchSession,
  purchaseCustomStoreOnWeb,
  purchaseOnWeb,
  sessionsFor,
  subscribeWebFailure,
} from "../checkout/flow";
import { unknownFailure, type CheckoutFailure } from "../checkout/failure";
import { purchaseEventsFor } from "../checkout/events";

export type { CheckoutFailure, CheckoutFailureReason } from "../checkout/failure";
import { isCustomStoreProductIdentifier } from "../checkout/products";
import { hostOf } from "../host";
import { useAutoPrefetch } from "../checkout/hooks/useAutoPrefetch";
import { useIdentityRefresh } from "../checkout/hooks/useIdentityRefresh";
import { checkoutModeFor } from "../checkout/host/sdk";
import { prepaidCardsFromFragment } from "../checkout/teleport/boot";
import { teleportFor } from "../checkout/teleport/flow";
import { flowQuery } from "../checkout/teleport/teleporter";
import { QueryStoreContext } from "../navigation/query";
import type { CheckoutMode, PurchaseOutcome } from "../checkout/types";

/**
 * How a web checkout purchase ended. A `failed` Stripe purchase carries
 * `failure`: why the payment failed, `reason: "unknown"` when nobody
 * reported why. A custom store checkout reports no reason.
 */
export type WebCheckoutResult<TProduct extends SuperwallProduct = SuperwallProduct> = {
  status: PurchaseOutcome;
  product: TProduct;
  failure?: CheckoutFailure;
};

/**
 * The last web checkout purchase that failed: the product, and why the
 * payment failed in `reason`, with the store's own `code`, `declineCode` and
 * `message` when it gave them.
 */
export type WebCheckoutFailure<TProduct extends SuperwallProduct = SuperwallProduct> =
  CheckoutFailure & { status: "failed"; product: TProduct };

/**
 * A purchase that failed. A web checkout failure carries one of the
 * `CheckoutFailureReason`s; a store purchase made by the native SDK carries
 * `reason: "unknown"` (the SDK sends no detail) or `"superseded"` (another
 * purchase replaced it).
 */
export type PurchaseFailure<TProduct extends SuperwallProduct = SuperwallProduct> =
  | SuperwallPurchaseFailure<TProduct>
  | WebCheckoutFailure<TProduct>;

/**
 * Callbacks for a purchase, each optional. They fire on every platform: for
 * App Store and Play Store products bought through the native SDK, and for
 * Stripe products bought on the web (the embedded sheet, Apple Pay, hosted
 * checkout and a teleport). Custom store products fire none of them.
 */
export type PurchaseCallbacks<TProduct extends SuperwallProduct = SuperwallProduct> = {
  /** The purchase started. */
  onStart?: (product: TProduct) => void;
  /**
   * The shopper submitted payment in the sheet or authorized it in Apple
   * Pay. Web checkout only: the native SDKs do not report it.
   */
  onSubmit?: (product: TProduct) => void;
  /** The purchase was paid. */
  onComplete?: (product: TProduct) => void;
  /** The shopper left the checkout or the store's sheet without paying. */
  onAbandon?: (product: TProduct) => void;
  /**
   * A purchase failed, with why in `failure.reason`. In the embedded sheet
   * it fires on each decline while the shopper can still pay with another
   * card. On a teleport in the app it fires as soon as the page's payment
   * fails, while the shopper can still try again in the browser. On a
   * teleport page, calling `useTeleport().returnToApp()` here returns with
   * `reason=failed`.
   */
  onFailure?: (failure: PurchaseFailure<TProduct>) => void;
};

/**
 * `usePurchase` callbacks fire for every purchase on the paywall, whichever
 * component started it.
 */
export type UsePurchaseOptions<TProduct extends SuperwallProduct = SuperwallProduct> =
  PurchaseCallbacks<TProduct>;

/**
 * A `purchase()` call's options. Its callbacks fire only while this call is
 * in flight, beside any passed to `usePurchase`.
 */
export type PurchaseOptions<TProduct extends SuperwallProduct = SuperwallProduct> =
  SuperwallPurchaseOptions & PurchaseCallbacks<TProduct>;

export type PurchaseResult<TVariables extends SuperwallProductVariables> =
  | SuperwallPurchaseResult<SuperwallProduct<TVariables>>
  | WebCheckoutResult<SuperwallProduct<TVariables>>;

export type UsePurchaseResult<TVariables extends SuperwallProductVariables> = {
  purchase: (
    input: ProductReference | SuperwallProduct<TVariables>,
    options?: PurchaseOptions<SuperwallProduct<TVariables>>,
  ) => Promise<PurchaseResult<TVariables>>;
  isPurchasing: boolean;
  pendingProduct?: SuperwallProduct<TVariables>;
  transaction?: SuperwallTransaction<SuperwallProduct<TVariables>>;
  failure?: PurchaseFailure<SuperwallProduct<TVariables>>;
  prefetch: (
    input?: ProductReference | SuperwallProduct<TVariables>,
    options?: Pick<SuperwallPurchaseOptions, "checkout" | "prepaidCards">,
  ) => void;
};

const referenceOf = (input: string | { reference: string }): string =>
  typeof input === "string" ? input : input.reference;

const listen = <TProduct extends SuperwallProduct>(
  paywall: { getSnapshot: () => { productsByReference: Record<string, TProduct | undefined> } },
  callbacks: () => PurchaseCallbacks<TProduct>,
): (() => void) => {
  const events = purchaseEventsFor(paywall);
  const productOf = (referenceName: string) =>
    paywall.getSnapshot().productsByReference[referenceName];
  const each =
    (pick: (current: PurchaseCallbacks<TProduct>) => ((product: TProduct) => void) | undefined) =>
    ({ referenceName }: { referenceName: string }) => {
      const product = productOf(referenceName);
      if (product) pick(callbacks())?.(product);
    };
  const unsubscribers = [
    events.on(
      "start",
      each((current) => current.onStart),
    ),
    events.on(
      "submit",
      each((current) => current.onSubmit),
    ),
    events.on(
      "complete",
      each((current) => current.onComplete),
    ),
    events.on(
      "abandon",
      each((current) => current.onAbandon),
    ),
    events.on("failure", ({ referenceName, failure }) => {
      const product = productOf(referenceName);
      if (product) {
        callbacks().onFailure?.({
          ...failure,
          status: "failed",
          product,
        } as PurchaseFailure<TProduct>);
      }
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
};

const reportStorePurchase = (
  paywall: object,
  reference: string,
  purchase: () => Promise<SuperwallPurchaseResult>,
): Promise<SuperwallPurchaseResult> => {
  const events = purchaseEventsFor(paywall);
  events.emit("start", { referenceName: reference });
  return purchase().then((result) => {
    const referenceName = result.product.reference;
    if (result.status === "completed") events.emit("complete", { referenceName });
    else if (result.status === "abandoned") events.emit("abandon", { referenceName });
    else events.emit("failure", { referenceName, failure: { reason: result.reason } });
    return result;
  });
};

/**
 * Buy a product. Store products go to the native SDK; a Stripe product is
 * always bought on the web. With `checkout: "sheet"` it opens Stripe's
 * embedded sheet; with `"applePay"` it opens the wallet where the device
 * offers it and falls back to the sheet; otherwise, and always inside an iOS
 * app, it opens Superwall's hosted checkout in the browser. A `purchase()` or
 * `prefetch()` call can pass its own `checkout` mode, under the same iOS
 * rule, and its own `prepaidCards`. Web checkout only runs when a host
 * supplied a public API key. On a hosted web paywall a custom store product
 * opens its store's checkout in the same tab.
 *
 * `options` are callbacks for every purchase on the paywall; `purchase()`
 * takes the same callbacks for that one call. `failure` is the last purchase
 * that failed, cleared when the next one starts.
 */
export const usePurchase = <
  TVariables extends SuperwallProductVariables = SuperwallProductVariables,
>(
  options: UsePurchaseOptions<SuperwallProduct<TVariables>> = {},
): UsePurchaseResult<TVariables> => {
  const session = useSuperwallSession<SuperwallProduct<TVariables>>();
  const callbacks = React.useRef(options);
  callbacks.current = options;
  const queryStore = React.useContext(QueryStoreContext);
  const snapshot = useSuperwallSnapshot<SuperwallProduct<TVariables>>();

  const mode = checkoutModeFor(snapshot);
  const hasApiKey =
    typeof snapshot.device.publicApiKey === "string" && snapshot.device.publicApiKey !== "";

  const webMode: CheckoutMode | undefined = hasApiKey ? mode : undefined;
  useAutoPrefetch();
  useIdentityRefresh();

  const buy = React.useCallback(
    async (
      input: ProductReference | SuperwallProduct<TVariables>,
      purchaseOptions: SuperwallPurchaseOptions,
    ): Promise<PurchaseResult<TVariables>> => {
      const reference = referenceOf(input);
      const product = session.getSnapshot().productsByReference[reference];
      const teleporter = teleportFor(session);
      const { postPurchase, stripeMetadata, prepaidCards } = purchaseOptions;
      clearWebFailure(session);
      if (
        product &&
        sessionsFor(session).isStripeProduct(reference) &&
        teleporter.kind === "app" &&
        teleporter.available()
      ) {
        const events = purchaseEventsFor(session);
        events.emit("start", { referenceName: reference });
        const outcome = await teleporter.begin({
          productReference: reference,
          query: flowQuery(queryStore),
          postPurchase,
          stripeMetadata,
          prepaidCards,
        });
        const status = typeof outcome === "string" ? outcome : (await outcome.result).status;
        const settledReference = typeof outcome === "string" ? reference : outcome.reference;
        const bought = session.getSnapshot().productsByReference[settledReference] ?? product;
        if (status === "completed") events.emit("complete", { referenceName: settledReference });
        if (status === "abandoned") events.emit("abandon", { referenceName: settledReference });
        if (status !== "failed") return { status, product: bought };
        const failure = unknownFailure();
        events.emit("failure", { referenceName: settledReference, failure });
        return { status, product: bought, failure };
      }
      if (webMode && product && sessionsFor(session).isStripeProduct(reference)) {
        if (teleporter.kind === "page" && !(await teleporter.whenUnsettled())) {
          return { status: "abandoned", product };
        }
        const rule =
          prepaidCards ?? (teleporter.kind === "page" ? prepaidCardsFromFragment() : undefined);
        const outcome = await purchaseOnWeb(
          session,
          reference,
          purchaseOptions.checkout ?? webMode,
          {
            postPurchase,
            stripeMetadata,
            ...(rule === undefined ? {} : { prepaidCards: rule }),
          },
        );
        return { ...outcome, product };
      }
      if (
        product &&
        isCustomStoreProductIdentifier(product.productId) &&
        (hostOf() === "web-paywall" || hostOf() === "web-sdk")
      ) {
        const status = await purchaseCustomStoreOnWeb(session, reference, { postPurchase });
        return { status, product };
      }
      if (teleporter.kind === "page" && product) {
        console.warn(
          `A teleport page sells only Stripe products, so "${reference}" can't be bought here.`,
        );
        return { status: "failed", product };
      }
      const store = () =>
        reportStorePurchase(session, reference, () => session.purchase(input, purchaseOptions));
      if (teleporter.kind === "page" || !teleporter.inFlight()) {
        return store() as Promise<PurchaseResult<TVariables>>;
      }
      return teleporter.handOff(reference, store) as Promise<PurchaseResult<TVariables>>;
    },
    [session, webMode, queryStore],
  );

  const purchase = React.useCallback(
    async (
      input: ProductReference | SuperwallProduct<TVariables>,
      withCallbacks?: PurchaseOptions<SuperwallProduct<TVariables>>,
    ): Promise<PurchaseResult<TVariables>> => {
      const { onStart, onSubmit, onComplete, onAbandon, onFailure, ...purchaseOptions } =
        withCallbacks ?? {};
      const own = { onStart, onSubmit, onComplete, onAbandon, onFailure };
      const stop = listen(session, () => own);
      try {
        return await buy(input, purchaseOptions);
      } finally {
        stop();
      }
    },
    [session, buy],
  );

  React.useEffect(() => listen(session, () => callbacks.current), [session]);

  const webFailure = React.useSyncExternalStore(
    React.useCallback((listener: () => void) => subscribeWebFailure(session, listener), [session]),
    () => lastWebFailure(session),
  );
  const webFailureProduct = webFailure
    ? snapshot.productsByReference[webFailure.referenceName]
    : undefined;
  const failure = React.useMemo(
    () =>
      webFailure && webFailureProduct
        ? { ...webFailure.failure, status: "failed" as const, product: webFailureProduct }
        : snapshot.lastPurchaseFailure,
    [webFailure, webFailureProduct, snapshot.lastPurchaseFailure],
  );

  const first = snapshot.products[0]?.reference;
  const prefetch = React.useCallback(
    (
      input?: ProductReference | SuperwallProduct<TVariables>,
      options?: Pick<SuperwallPurchaseOptions, "checkout" | "prepaidCards">,
    ) => {
      const reference = input === undefined ? first : referenceOf(input);
      if (!webMode || reference === undefined) return;
      if (!sessionsFor(session).isStripeProduct(reference)) return;
      const snapshot = session.getSnapshot();
      void prefetchSession(
        session,
        reference,
        checkoutModeFor(snapshot, options?.checkout ?? webMode),
        options?.prepaidCards,
      );
    },
    [session, webMode, first],
  );

  return React.useMemo(
    () => ({
      purchase,
      prefetch,
      isPurchasing: snapshot.pendingPurchase !== undefined,
      pendingProduct: snapshot.pendingPurchase?.product,
      transaction: snapshot.lastTransaction,
      failure,
    }),
    [purchase, prefetch, snapshot.pendingPurchase, snapshot.lastTransaction, failure],
  );
};
