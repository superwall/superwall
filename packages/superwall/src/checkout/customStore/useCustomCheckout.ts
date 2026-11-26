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
  /** The product reference the checkout sells, as passed to `startCheckout`. */
  product: string;
};

export type CustomCheckoutResult = "completed" | "abandoned" | "timeout";

export type WaitForPurchaseOptions = {
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
 * - `startCheckout(product)` asks Superwall for a checkout and returns it, staying on the page.
 *   On a teleport page the purchase is the app's user's, and the app unlocks on its own.
 * - `waitForPurchase(checkout)` asks Superwall until the store's purchase event arrived.
 * - `openCheckoutUrl(checkout)` sends the browser to the store's checkout page instead.
 * - `abandon(checkout)` reports that the buyer gave up.
 *
 * Outside a teleport page, `usePurchase().purchase()` also sells a store that only has a
 * checkout page.
 */
export const useCustomCheckout = () => {
  const session = useSuperwallSession();

  const startCheckout = React.useCallback(
    async (reference: string): Promise<CustomCheckout> => {
      const snapshot = session.getSnapshot();
      const product = productOf(snapshot, reference);
      const productIdentifier = product?.productId ?? reference;
      const host = hostFor(session);
      const fail = (message: string, tag?: string): never => {
        host.customFailed(productIdentifier, message);
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
      startLoading();
      let started: Awaited<ReturnType<typeof requestCustomStoreSession>>;
      try {
        started = await requestCustomStoreSession(snapshot, product!);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Custom store checkout failed";
        host.customFailed(productIdentifier, message);
        throw error instanceof CustomStoreCheckoutError
          ? error
          : new CustomStoreCheckoutError(message);
      } finally {
        stopLoading();
        release();
      }
      host.customStarted(productIdentifier, started.checkoutContextId, started.customTransactionId);
      return {
        checkoutContextId: started.checkoutContextId,
        checkoutUrl: started.checkoutUrl,
        customTransactionId: started.customTransactionId,
        ...(started.metadata === undefined ? {} : { metadata: started.metadata }),
        product: reference,
      };
    },
    [session],
  );

  const waitForPurchase = React.useCallback(
    async (
      checkout: CustomCheckout,
      options: WaitForPurchaseOptions = {},
    ): Promise<CustomCheckoutResult> => {
      const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
      const key = String(session.getSnapshot().device.publicApiKey ?? "");
      for (;;) {
        const status = await readCustomStoreStatus(key, checkout.checkoutContextId);
        if (status === "completed") {
          purchaseEventsFor(session).emit("complete", { referenceName: checkout.product });
          return "completed";
        }
        if (status === "abandoned") {
          purchaseEventsFor(session).emit("abandon", { referenceName: checkout.product });
          return "abandoned";
        }
        if (Date.now() + interval > deadline) return "timeout";
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    },
    [session],
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
    },
    [session],
  );

  return React.useMemo(
    () => ({ startCheckout, waitForPurchase, openCheckoutUrl, abandon }),
    [startCheckout, waitForPurchase, openCheckoutUrl, abandon],
  );
};
