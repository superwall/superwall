import type { SuperwallRuntimeSnapshot, SuperwallSession } from "@superwall/runtime";
import { checkoutModeOf, checkoutPrefetchOf } from "@superwall/runtime";
import { WebCheckoutController } from "./WebCheckoutController";
import { ApplePayCheckoutController, type ApplePayOutcome } from "./ApplePayCheckoutController";
import { checkoutEvents } from "./CheckoutEvents";
import { checkoutHostEvents, type CheckoutHostContext } from "./hostEvents";
import { startLoading, stopLoading } from "./loading";
import type { CheckoutMode, EmbeddedCheckoutSession, SessionData } from "../state/types";
import { APPLE_PAY_PREFETCH_LIMIT } from "../utils/constants";

/**
 * The runtime session, as the checkout layer needs it: a snapshot to read
 * products and identity from, and the bridge to tell the SDK what happened.
 */
export type CheckoutSession = Pick<SuperwallSession, "getSnapshot" | "postMessage">;

const controllers = new WeakMap<object, WebCheckoutController>();
const applePayControllers = new WeakMap<object, ApplePayCheckoutController>();

export const controllerFor = (session: CheckoutSession): WebCheckoutController => {
  const existing = controllers.get(session);
  if (existing) return existing;
  const controller = new WebCheckoutController(
    () => session.getSnapshot() as SuperwallRuntimeSnapshot,
  );

  controller.subscribeDiscountDropped(() => {
    invalidateSessions(session, "discount code dropped");
    reprefetch(session);
  });
  controllers.set(session, controller);
  return controller;
};

export const hostEventsFor = (session: CheckoutSession) =>
  checkoutHostEvents((message) => session.postMessage(message));

export const applePayControllerFor = (session: CheckoutSession): ApplePayCheckoutController => {
  const existing = applePayControllers.get(session);
  if (existing) return existing;
  const controller = new ApplePayCheckoutController({
    publicApiKey: () => String(session.getSnapshot().device.publicApiKey ?? ""),
    host: hostEventsFor(session),
  });
  applePayControllers.set(session, controller);
  return controller;
};

/** The SDK-facing facts about a purchase of `referenceName`. */
export const hostContextFor = (
  session: CheckoutSession,
  referenceName: string,
  checkoutContextId: string,
): CheckoutHostContext => {
  const snapshot = session.getSnapshot();
  const product = snapshot.productsByReference[referenceName];
  const eventName = snapshot.params.event_name;
  return {
    checkoutContextId,
    productIdentifier: product?.productId ?? "",
    paywallIdentifier: snapshot.paywall?.identifier,
    experimentVariantId: snapshot.experiment?.variantId,
    ...(typeof eventName === "string" ? { presentedByEventName: eventName } : {}),
  };
};

/**
 * Forgets every cached and prepared session — the quotes are stale (a code
 * was redeemed or cleared, say) — and empties the sheet's pool.
 */
export const invalidateSessions = (session: CheckoutSession, reason: string) => {
  controllerFor(session).clearSessionCache();
  applePayControllerFor(session).clear();
  checkoutEvents.dispatch("SESSION_INVALIDATED", { reason });
};

/**
 * Which products to warm on open: the configured one (or the first Stripe
 * product) for the sheet; for Apple Pay every Stripe product, preferred one
 * first, up to the limit, because the wallet is prepared per product.
 */
export const autoPrefetchTargets = (session: CheckoutSession, mode: CheckoutMode): string[] => {
  const snapshot = session.getSnapshot();
  const controller = controllerFor(session);
  const configured = checkoutPrefetchOf(snapshot.config?.checkout);
  if (configured === false) return [];
  const stripeReferences = snapshot.products
    .map((product) => product.reference)
    .filter((reference) => controller.isStripeProduct(reference));
  if (stripeReferences.length === 0) return [];

  const preferred =
    typeof configured === "string" && stripeReferences.includes(configured)
      ? configured
      : (stripeReferences[0] as string);
  if (mode !== "applePay") return [preferred];
  return [preferred, ...stripeReferences.filter((reference) => reference !== preferred)].slice(
    0,
    APPLE_PAY_PREFETCH_LIMIT,
  );
};

/** Warms the auto-prefetch targets again, e.g. after quotes were invalidated. */
export const reprefetch = (session: CheckoutSession) => {
  const mode = checkoutModeOf(session.getSnapshot().config?.checkout);
  if (mode !== "sheet" && mode !== "applePay") return;
  if (!session.getSnapshot().device.publicApiKey) return;
  for (const reference of autoPrefetchTargets(session, mode)) {
    void prefetchSession(session, reference, mode);
  }
};

const CHECKOUT_READY_TIMEOUT = 20_000;

export const poolSession = (session: EmbeddedCheckoutSession) => {
  checkoutEvents.dispatch("SESSION_CREATED", session as SessionData);
};

/**
 * Warms one product: fetches its session and, depending on what came back,
 * prepares the wallet (an `elements` quote) or pre-mounts Stripe's sheet
 * hidden (an `embedded` session). The SDK hears about it either way.
 */
export const prefetchSession = async (
  session: CheckoutSession,
  referenceName: string,
  mode: CheckoutMode,
): Promise<void> => {
  const controller = controllerFor(session);
  const result = await controller.prefetchCheckout({
    referenceName,
    mode,
    cacheScope: mode === "applePay" ? "apple-pay" : "default",
    silent: true,
  });
  if (!result) return;

  hostEventsFor(session).prefetched(
    hostContextFor(session, referenceName, result.checkoutContextId),
  );

  if (result.directive === "elements") {
    if (mode !== "applePay") return;
    const applePay = applePayControllerFor(session);
    try {
      await applePay.prepare(result, controller.identity());
    } catch {
      applePay.markUnavailable(referenceName, "prepare_failed");
    }
    return;
  }
  if (result.directive === "embedded") {
    if (mode === "applePay") {
      applePayControllerFor(session).markUnavailable(referenceName, "no_apple_pay_quote");
    }
    poolSession(result);
  }
};

/**
 * Opens the wallet for a product. `unavailable` means the caller should
 * take the embedded sheet instead; every other status is the purchase's
 * outcome.
 */
export const purchaseWithApplePay = (
  session: CheckoutSession,
  referenceName: string,
): Promise<ApplePayOutcome> => {
  const applePay = applePayControllerFor(session);
  const cached = controllerFor(session).getCachedSession(referenceName, "apple-pay");
  const checkoutContextId = cached?.checkoutContextId ?? "";
  return applePay.purchase(
    referenceName,
    hostContextFor(session, referenceName, checkoutContextId),
  );
};

export const openEmbeddedCheckout = (
  embedded: EmbeddedCheckoutSession,
  host?: { session: CheckoutSession; referenceName: string },
): Promise<{ status: string }> =>
  new Promise((resolve) => {
    const sessionData = embedded as SessionData;
    const events = host ? hostEventsFor(host.session) : null;
    const context = host
      ? hostContextFor(host.session, host.referenceName, embedded.checkoutContextId)
      : null;
    let opened = false;

    const readyTimeout = setTimeout(() => {
      if (!opened) finish({ status: "failed" });
    }, CHECKOUT_READY_TIMEOUT);

    const isOurs = (candidate: { directive: string; clientSecret?: string }) =>
      candidate.directive === "embedded" && candidate.clientSecret === sessionData.clientSecret;

    const unsubscribers = [
      checkoutEvents.subscribe("EMBEDDED_READY", ({ clientSecret }) => {
        if (clientSecret !== sessionData.clientSecret || opened) return;
        opened = true;
        clearTimeout(readyTimeout);
        stopLoading();
        checkoutEvents.dispatch("SHEET_OPEN", { session: sessionData });
        if (context) events?.initiated(context);
      }),
      checkoutEvents.subscribe("CHECKOUT_SUBMITTED", ({ session: submitted }) => {
        if (!isOurs(submitted) || !context) return;
        events?.submitted(context);
      }),
      checkoutEvents.subscribe("PAYMENT_SUCCESS", ({ session: paid }) => {
        if (!isOurs(paid)) return;
        if (context) events?.completed(context, sessionData.checkoutSessionId);
        finish({ status: "completed" });
      }),
      checkoutEvents.subscribe("PAYMENT_ERROR", ({ session: errored }) => {
        if (!isOurs(errored)) return;
        if (context) events?.failed(context);
        finish({ status: "failed" });
      }),
      checkoutEvents.subscribe("SHEET_CLOSE", () => {
        if (!opened) return;
        if (context) events?.abandoned(context);
        finish({ status: "abandoned" });
      }),
    ];

    const finish = (outcome: { status: string }) => {
      clearTimeout(readyTimeout);
      stopLoading();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      resolve(outcome);
    };

    startLoading();
    checkoutEvents.dispatch("SESSION_CREATED", sessionData);
  });
