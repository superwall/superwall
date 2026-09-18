import type { SuperwallPostPurchase, SuperwallSession } from "@superwall/runtime";
import { checkoutModeOf, checkoutPrefetchOf, detectSuperwallHost } from "@superwall/runtime";
import { createApplePay, type ApplePay, type ApplePayOutcome } from "./applePay";
import { asString, field } from "./api/decode";
import { fetchWithRetry } from "./api/fetch";
import { subscriptionsApiUrl } from "./api/url";
import { checkoutEvents } from "./events";
import { hostEvents, type HostContext, type HostEvents } from "./host";
import { sdkHostsCheckoutInPaywall, sdkRedeemsCheckout } from "./host/sdk";
import { bindsEntitlement, hostedInWebSdk } from "./host/surface";
import { startLoading, stopLoading } from "./loading";
import { createCheckoutSessions, type CheckoutSessions } from "./session";
import type {
  CheckoutMode,
  DiscountValidationResult,
  EmbeddedCheckoutSession,
  PostCheckoutResolution,
  PostPurchaseBehavior,
  PurchaseOutcome,
  RedirectCheckoutSession,
  WebPurchaseOptions,
} from "./types";

export type CompletedCheckout = {
  referenceName: string;
  checkoutContextId: string;
  checkoutSessionId: string | null;
  postPurchaseBehavior?: PostPurchaseBehavior;
};

const purchaseOptionsByPaywall = new WeakMap<object, Map<string, WebPurchaseOptions>>();

const rememberPurchaseOptions = (
  paywall: PaywallSession,
  referenceName: string,
  options: WebPurchaseOptions,
) => {
  const existing = purchaseOptionsByPaywall.get(paywall) ?? new Map<string, WebPurchaseOptions>();
  existing.set(referenceName, options);
  purchaseOptionsByPaywall.set(paywall, existing);
};

const takePurchaseOptions = (
  paywall: PaywallSession,
  referenceName: string,
): WebPurchaseOptions => {
  const options = purchaseOptionsByPaywall.get(paywall);
  const taken = options?.get(referenceName) ?? {};
  options?.delete(referenceName);
  return taken;
};

export const resolutionOf = (
  postPurchase: SuperwallPostPurchase | undefined,
): PostCheckoutResolution | undefined => {
  if (postPurchase === undefined || postPurchase === "dismiss") return undefined;
  if (postPurchase === "stay") return { type: "paywall" };
  if (postPurchase === "redeem") return { type: "redeem" };
  return { type: "redirect", url: postPurchase.redirect };
};

const APPLE_PAY_PREFETCH_LIMIT = 10;
const SHEET_READY_TIMEOUT = 20_000;
const STATUS_POLL_INTERVAL = 2_000;
const STATUS_POLL_LIMIT = 60;

export type PaywallSession = Pick<SuperwallSession, "getSnapshot" | "postMessage">;

const sessionsByPaywall = new WeakMap<object, CheckoutSessions>();
const applePayByPaywall = new WeakMap<object, ApplePay>();

export const sessionsFor = (paywall: PaywallSession): CheckoutSessions => {
  const existing = sessionsByPaywall.get(paywall);
  if (existing) return existing;
  const sessions = createCheckoutSessions(() => paywall.getSnapshot());
  sessions.discounts.subscribeDropped(() => {
    invalidateSessions(paywall, "discount code dropped");
    reprefetch(paywall);
  });
  sessionsByPaywall.set(paywall, sessions);
  return sessions;
};

export const hostFor = (paywall: PaywallSession): HostEvents =>
  hostEvents((message) => paywall.postMessage(message));

export const applePayFor = (paywall: PaywallSession): ApplePay => {
  const existing = applePayByPaywall.get(paywall);
  if (existing) return existing;
  const applePay = createApplePay({
    publicApiKey: () => String(paywall.getSnapshot().device.publicApiKey ?? ""),
    host: hostFor(paywall),
  });
  applePayByPaywall.set(paywall, applePay);
  return applePay;
};

export const contextFor = (
  paywall: PaywallSession,
  referenceName: string,
  checkoutContextId: string,
): HostContext => {
  const snapshot = paywall.getSnapshot();
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

export const invalidateSessions = (paywall: PaywallSession, reason: string) => {
  sessionsFor(paywall).invalidate();
  applePayFor(paywall).clear();
  checkoutEvents.dispatch("SESSION_INVALIDATED", { reason });
};

export const redeemDiscount = async (
  paywall: PaywallSession,
  code: string,
): Promise<DiscountValidationResult> => {
  const result = await sessionsFor(paywall)
    .redeemDiscount(code)
    .catch((error: unknown) => {
      console.error("Error redeeming a promotion code:", error);
      return { valid: false as const, reason: "error" };
    });

  if (result.valid) {
    invalidateSessions(paywall, "discount code redeemed");
    reprefetch(paywall);
  }
  hostFor(paywall).redemption(code.trim(), result);
  return result;
};

export const clearDiscount = (paywall: PaywallSession) => {
  const sessions = sessionsFor(paywall);
  if (!sessions.discounts.applied) return;
  sessions.clearDiscount();
  invalidateSessions(paywall, "discount code cleared");
  reprefetch(paywall);
};

export const autoPrefetchTargets = (paywall: PaywallSession, mode: CheckoutMode): string[] => {
  const snapshot = paywall.getSnapshot();
  const sessions = sessionsFor(paywall);
  const configured = checkoutPrefetchOf(snapshot.config?.checkout);
  if (configured === false) return [];
  const stripeReferences = snapshot.products
    .map((product) => product.reference)
    .filter((reference) => sessions.isStripeProduct(reference));
  const [firstStripe] = stripeReferences;
  if (firstStripe === undefined) return [];

  const preferred =
    typeof configured === "string" && stripeReferences.includes(configured)
      ? configured
      : firstStripe;
  if (mode !== "applePay") return [preferred];
  return [preferred, ...stripeReferences.filter((reference) => reference !== preferred)].slice(
    0,
    APPLE_PAY_PREFETCH_LIMIT,
  );
};

export const reprefetch = (paywall: PaywallSession) => {
  const mode = checkoutModeOf(paywall.getSnapshot().config?.checkout);
  if (mode !== "sheet" && mode !== "applePay") return;
  if (!paywall.getSnapshot().device.publicApiKey) return;
  if (!sdkHostsCheckoutInPaywall(paywall.getSnapshot())) return;
  for (const reference of autoPrefetchTargets(paywall, mode)) {
    void prefetchSession(paywall, reference, mode);
  }
};

export const prefetchSession = async (
  paywall: PaywallSession,
  referenceName: string,
  mode: CheckoutMode,
): Promise<void> => {
  const sessions = sessionsFor(paywall);
  const result = await sessions.prefetch({
    referenceName,
    mode,
    scope: mode === "applePay" ? "apple-pay" : "default",
    silent: true,
  });
  if (!result) return;

  hostFor(paywall).prefetched(contextFor(paywall, referenceName, result.checkoutContextId));

  if (result.directive === "elements") {
    if (mode !== "applePay") return;
    const applePay = applePayFor(paywall);
    try {
      await applePay.prepare(result, sessions.identity());
    } catch {
      applePay.markUnavailable(referenceName, "prepare_failed");
    }
    return;
  }
  if (result.directive === "embedded") {
    if (mode === "applePay") {
      applePayFor(paywall).markUnavailable(referenceName, "no_apple_pay_quote");
    }
    checkoutEvents.dispatch("SESSION_CREATED", result);
  }
};

export const reportCompletedCheckout = async (
  paywall: PaywallSession,
  session: CompletedCheckout,
  redemptionUrl?: string,
): Promise<void> => {
  const host = hostFor(paywall);
  const context = contextFor(paywall, session.referenceName, session.checkoutContextId);
  const options = takePurchaseOptions(paywall, session.referenceName);

  if (options.stripeMetadata) {
    try {
      await sessionsFor(paywall).attachMetadata(session.checkoutContextId, options.stripeMetadata);
    } catch (error) {
      console.error("Attaching checkout metadata failed:", error);
    }
  }

  let entitlementsToken: string | undefined;
  if (hostedInWebSdk() && bindsEntitlement(session.postPurchaseBehavior)) {
    try {
      entitlementsToken = await sessionsFor(paywall).completeWebapp(session.checkoutContextId);
    } catch (error) {
      console.error("Completing the Web SDK checkout failed:", error);
    }
  }

  const resolution = resolutionOf(
    options.postPurchase ?? paywall.getSnapshot().config?.postPurchase,
  );
  host.completed(
    context,
    session.checkoutSessionId,
    session.postPurchaseBehavior,
    resolution,
    entitlementsToken,
  );

  if (sdkRedeemsCheckout(paywall.getSnapshot())) return;
  if (redemptionUrl !== undefined) {
    host.redeem(redemptionUrl);
    return;
  }

  const publicApiKey = asString(paywall.getSnapshot().device.publicApiKey);
  if (!publicApiKey) {
    console.error("Cannot redeem a web purchase: the host sent no public API key.");
    return;
  }

  try {
    const response = await fetchWithRetry(subscriptionsApiUrl("checkout/session/complete"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${publicApiKey}` },
      body: JSON.stringify({ checkoutContextId: session.checkoutContextId }),
    });
    const link = field(await response.json(), "redemptionUrl");
    if (typeof link === "string" && link !== "") host.redeem(link);
    else console.warn("The checkout backend returned no redemption URL.");
  } catch (error) {
    console.error("Redeeming the web purchase failed:", error);
  }
};

const watchHostedCheckout = async (
  paywall: PaywallSession,
  redirect: RedirectCheckoutSession,
): Promise<PurchaseOutcome> => {
  const sessions = sessionsFor(paywall);

  for (let attempt = 0; attempt < STATUS_POLL_LIMIT; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL));
    const status = await sessions
      .status(redirect.checkoutContextId)
      .catch(() => ({ status: "pending" }) as const);

    if (status.status === "completed") {
      await reportCompletedCheckout(paywall, redirect, status.redemptionUrl);
      return "completed";
    }
    if (status.status === "abandoned") return "abandoned";
  }

  console.warn("Gave up watching a hosted checkout after two minutes.");
  return "abandoned";
};

export const openHostedCheckout = async (
  paywall: PaywallSession,
  redirect: RedirectCheckoutSession,
): Promise<PurchaseOutcome> => {
  const host = hostFor(paywall);
  host.initiated(contextFor(paywall, redirect.referenceName, redirect.checkoutContextId));

  if (!detectSuperwallHost()) {
    window.location.assign(redirect.checkoutUrl);
    return "abandoned";
  }

  host.openHostedPage(redirect.checkoutUrl);
  return watchHostedCheckout(paywall, redirect);
};

export const watchCompletedCheckouts = (paywall: PaywallSession): (() => void) =>
  checkoutEvents.subscribe("PAYMENT_SUCCESS", ({ session }) => {
    void reportCompletedCheckout(paywall, session);
  });

export const purchaseWithApplePay = (
  paywall: PaywallSession,
  referenceName: string,
): Promise<ApplePayOutcome> => {
  const warmed = sessionsFor(paywall).cache.get(referenceName, "apple-pay");
  return applePayFor(paywall).purchase(
    referenceName,
    contextFor(paywall, referenceName, warmed?.checkoutContextId ?? ""),
  );
};

export const openEmbeddedSheet = (
  embedded: EmbeddedCheckoutSession,
  host?: { paywall: PaywallSession; referenceName: string },
): Promise<{ status: PurchaseOutcome }> =>
  new Promise((resolve) => {
    const events = host ? hostFor(host.paywall) : null;
    const context = host
      ? contextFor(host.paywall, host.referenceName, embedded.checkoutContextId)
      : null;
    let opened = false;

    const readyTimeout = setTimeout(() => {
      if (!opened) finish("failed");
    }, SHEET_READY_TIMEOUT);

    const isOurs = (candidate: { directive: string; clientSecret?: string }) =>
      candidate.directive === "embedded" && candidate.clientSecret === embedded.clientSecret;

    const unsubscribers = [
      checkoutEvents.subscribe("EMBEDDED_READY", ({ clientSecret }) => {
        if (clientSecret !== embedded.clientSecret || opened) return;
        opened = true;
        clearTimeout(readyTimeout);
        stopLoading();
        checkoutEvents.dispatch("SHEET_OPEN", { session: embedded });
        if (context) events?.initiated(context);
      }),
      checkoutEvents.subscribe("CHECKOUT_SUBMITTED", ({ session: submitted }) => {
        if (!isOurs(submitted) || !context) return;
        events?.submitted(context);
      }),
      checkoutEvents.subscribe("PAYMENT_SUCCESS", ({ session: paid }) => {
        if (!isOurs(paid)) return;
        finish("completed");
      }),
      checkoutEvents.subscribe("PAYMENT_ERROR", ({ session: errored }) => {
        if (!isOurs(errored)) return;
        if (context) events?.failed(context);
        finish("failed");
      }),
      checkoutEvents.subscribe("SHEET_CLOSE", () => {
        if (!opened) return;
        if (context) events?.abandoned(context);
        finish("abandoned");
      }),
    ];

    const finish = (status: PurchaseOutcome) => {
      clearTimeout(readyTimeout);
      stopLoading();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      resolve({ status });
    };

    startLoading();
    checkoutEvents.dispatch("SESSION_CREATED", embedded);
  });

export const purchaseOnWeb = async (
  paywall: PaywallSession,
  referenceName: string,
  requested: CheckoutMode,
  options: WebPurchaseOptions = {},
): Promise<PurchaseOutcome> => {
  const sessions = sessionsFor(paywall);
  const mode = sdkHostsCheckoutInPaywall(paywall.getSnapshot()) ? requested : "external";
  rememberPurchaseOptions(paywall, referenceName, options);
  try {
    if (mode === "applePay") {
      const outcome = await purchaseWithApplePay(paywall, referenceName);
      if (outcome.status !== "unavailable") return outcome.status;
    }

    const warmed = mode === "applePay" ? sessions.cache.get(referenceName, "apple-pay") : null;
    const result =
      warmed?.directive === "embedded"
        ? warmed
        : await sessions.begin({
            referenceName,
            mode: mode === "external" ? "external" : "sheet",
            scope: "default",
          });

    if (result.directive === "embedded") {
      return (await openEmbeddedSheet(result, { paywall, referenceName })).status;
    }
    if (result.directive === "redirect") return openHostedCheckout(paywall, result);
    return "failed";
  } catch (error) {
    console.error("Error beginning web checkout:", error);
    return "failed";
  }
};
