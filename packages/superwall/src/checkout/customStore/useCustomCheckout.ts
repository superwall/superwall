import * as React from "react";
import {
  createSuperwallProduct,
  productIdFor,
  type SuperwallProduct,
  type SuperwallRuntimeSnapshot,
} from "@superwall/runtime";
import { useSuperwallSession } from "../../provider/context";
import { readCustomStoreStatus } from "../api/customStore";
import { asString } from "../api/decode";
import { purchaseEventsFor } from "../events";
import { hostFor } from "../flow";
import { hostOf } from "../../host";
import { startLoading, stopLoading } from "../loading";
import { bareProductIdentifier } from "../products";
import { teleportFor } from "../teleport/flow";
import {
  claimCustomStoreCheckout,
  CustomStoreCheckoutError,
  requestCustomStoreSession,
} from "./index";

/**
 * A custom store checkout Superwall started for this page: what the page needs to show the
 * store's own checkout in place (`metadata`, from the store's checkout endpoint), to send the
 * buyer to it instead (`checkoutUrl`), and to ask whether it was paid (`checkoutContextId`).
 */
export type CustomCheckout = {
  /** Encrypted. Used to ask Superwall whether the checkout is paid. */
  checkoutContextId: string;
  /** The store's checkout page, for when the page can't embed it. */
  checkoutUrl: string;
  /** The reference the store's events carry back for this purchase. */
  customTransactionId: string;
  /** What the store's checkout endpoint answered beside the URL, untouched. */
  metadata?: Record<string, string>;
  /** The product reference the checkout sells, as passed to `start`. */
  product: string;
};

/**
 * Where the checkout is: `preparing` while Superwall starts it, `ready` once the page can show
 * it, `confirming` while `complete` waits for Superwall to see the purchase, then `completed`,
 * `abandoned` or `failed`.
 */
export type CustomCheckoutStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "confirming"
  | "completed"
  | "abandoned"
  | "failed";

export type CustomCheckoutResult = "completed" | "abandoned" | "timeout";

export type CompleteOptions = {
  /** How long to wait for Superwall to see the purchase. @default 300_000 (5 minutes) */
  timeoutMs?: number;
  /** How often to ask. @default 2_000 */
  intervalMs?: number;
};

/**
 * The product a reference names. A page has a record only of the products priced for it, so
 * any other falls back to the paywall's own config: its store id is all a session needs, since
 * the store prices the checkout itself.
 */
const productOf = (
  snapshot: SuperwallRuntimeSnapshot,
  reference: string,
): SuperwallProduct | undefined => {
  const known = snapshot.productsByReference[reference];
  if (known) return known;
  const slot = snapshot.config?.products?.[reference];
  const productId = slot === undefined ? undefined : productIdFor(slot);
  return productId === undefined
    ? undefined
    : createSuperwallProduct({ reference, productId, variables: {}, source: "inline" });
};

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 2_000;
const NAVIGATION_DELAY_MS = 250;

/**
 * A custom store checkout the page drives itself, for a store whose own checkout can be shown
 * in the page rather than opened as a link:
 *
 * - `start(product)` asks Superwall for a checkout and returns it, staying on the page.
 * - `complete(checkout)` is for when the store's checkout says it's done (after its own
 *   animation): it waits until Superwall sees the purchase, then on a teleport page finishes
 *   as a Stripe purchase does, by the paywall's `teleport.completion` (back to the app, or
 *   "You're all set"). The app unlocks either way.
 * - `abandon(checkout)` reports that the buyer gave up.
 * - `openCheckoutUrl(checkout)` sends the browser to the store's checkout page instead.
 *
 * Outside a teleport page, `usePurchase().purchase()` also sells a store that only has a
 * checkout page.
 */
export const useCustomCheckout = () => {
  const session = useSuperwallSession();
  const [status, setStatus] = React.useState<CustomCheckoutStatus>("idle");

  // On a teleport page, the page's own checks leave a purchase of an open checkout to `complete`.
  const holdTeleport = React.useCallback(
    (open: boolean) => {
      const teleporter = teleportFor(session);
      if (teleporter.kind === "page") teleporter.holdForCustomCheckout(open);
    },
    [session],
  );

  const start = React.useCallback(
    async (reference: string): Promise<CustomCheckout> => {
      const snapshot = session.getSnapshot();
      const product = productOf(snapshot, reference);
      const productIdentifier = product?.productId ?? reference;
      const host = hostFor(session);
      const fail = (message: string, tag?: string): never => {
        host.customFailed(productIdentifier, message);
        setStatus("failed");
        throw new CustomStoreCheckoutError(message, tag);
      };
      if (hostOf() === "web-sdk") fail("Custom store products aren't supported in the Web SDK yet");
      if (!product) fail(`No product "${reference}" on this paywall`);
      if (!asString(snapshot.device.publicApiKey)) {
        fail("Cannot start a custom store checkout: the host sent no public API key");
      }
      const release = claimCustomStoreCheckout(session);
      if (!release) {
        throw new CustomStoreCheckoutError("A checkout is already starting", "in_flight");
      }
      purchaseEventsFor(session).emit("start", { referenceName: reference });
      setStatus("preparing");
      startLoading();
      let started: Awaited<ReturnType<typeof requestCustomStoreSession>>;
      try {
        started = await requestCustomStoreSession(snapshot, product!);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Custom store checkout failed";
        host.customFailed(productIdentifier, message);
        setStatus("failed");
        throw error instanceof CustomStoreCheckoutError
          ? error
          : new CustomStoreCheckoutError(message);
      } finally {
        stopLoading();
        release();
      }
      host.customStarted(productIdentifier, started.checkoutContextId, started.customTransactionId);
      holdTeleport(true);
      setStatus("ready");
      return {
        checkoutContextId: started.checkoutContextId,
        checkoutUrl: started.checkoutUrl,
        customTransactionId: started.customTransactionId,
        ...(started.metadata === undefined ? {} : { metadata: started.metadata }),
        product: reference,
      };
    },
    [session, holdTeleport],
  );

  const complete = React.useCallback(
    async (
      checkout: CustomCheckout,
      options: CompleteOptions = {},
    ): Promise<CustomCheckoutResult> => {
      const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
      const key = String(session.getSnapshot().device.publicApiKey ?? "");
      setStatus("confirming");
      startLoading();
      try {
        for (;;) {
          const paid = await readCustomStoreStatus(key, checkout.checkoutContextId);
          if (paid === "abandoned") {
            purchaseEventsFor(session).emit("abandon", { referenceName: checkout.product });
            holdTeleport(false);
            setStatus("abandoned");
            return "abandoned";
          }
          if (paid === "completed") break;
          if (Date.now() + interval > deadline) {
            setStatus("ready");
            return "timeout";
          }
          await new Promise((resolve) => setTimeout(resolve, interval));
        }
        purchaseEventsFor(session).emit("complete", { referenceName: checkout.product });
        setStatus("completed");
        const teleporter = teleportFor(session);
        if (teleporter.kind === "page") {
          const productId = productOf(session.getSnapshot(), checkout.product)?.productId;
          await teleporter.completePurchase(checkout.checkoutContextId, {
            productIdentifier: `custom|${bareProductIdentifier(productId ?? checkout.product)}`,
          });
          teleporter.holdForCustomCheckout(false);
        }
        return "completed";
      } finally {
        stopLoading();
      }
    },
    [session, holdTeleport],
  );

  const openCheckoutUrl = React.useCallback((checkout: CustomCheckout) => {
    startLoading();
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      stopLoading();
      window.removeEventListener("pageshow", restore);
    };
    window.addEventListener("pageshow", restore);
    setTimeout(() => window.location.assign(checkout.checkoutUrl), NAVIGATION_DELAY_MS);
  }, []);

  const abandon = React.useCallback(
    (checkout: CustomCheckout) => {
      purchaseEventsFor(session).emit("abandon", { referenceName: checkout.product });
      holdTeleport(false);
      setStatus("abandoned");
    },
    [session, holdTeleport],
  );

  return React.useMemo(
    () => ({ status, start, complete, abandon, openCheckoutUrl }),
    [status, start, complete, abandon, openCheckoutUrl],
  );
};
