import type {
  SuperwallPostPurchase,
  SuperwallPrepaidCards,
  SuperwallSession,
} from "@superwall/runtime";
import { checkoutPrefetchOf, detectSuperwallHost } from "@superwall/runtime";
import { createApplePay, type ApplePay, type ApplePayOutcome } from "./applePay";
import { asString, field } from "./api/decode";
import { checkoutDiagnostics } from "./diagnostics";
import { fetchWithRetry } from "./api/fetch";
import { subscriptionsApiUrl } from "./api/url";
import { checkoutEvents, purchaseEventsFor } from "./events";
import { hostEvents, type HostContext, type HostEvents } from "./host";
import { checkoutModeFor, sdkRedeemsCheckout } from "./host/sdk";
import { presentingPlacement } from "./host/init";
import { hostOf } from "../host";
import { bindsEntitlement } from "./host/surface";
import { startLoading, stopLoading } from "./loading";
import {
  claimCustomStoreCheckout,
  requestCustomStoreSession,
  saveCustomStoreReturnRecord,
} from "./customStore";
import { createCheckoutSessions, type CheckoutSessions } from "./session";
import { unknownFailure, type CheckoutFailure } from "./failure";
import { introductoryOfferFromFragment, readTeleportBoot } from "./teleport/boot";
import { teleportFor } from "./teleport/flow";
import type {
  CheckoutMode,
  CheckoutSessionResult,
  DiscountValidationResult,
  EmbeddedCheckoutSession,
  PostCheckoutResolution,
  PostPurchaseBehavior,
  PurchaseOutcome,
  RedirectCheckoutSession,
  SessionScope,
  WebappCompletion,
  WebPurchaseOptions,
  WebPurchaseOutcome,
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
const SHEET_READY_TIMEOUT = 10_000;
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
  const eventName = presentingPlacement(snapshot.params).name;
  return {
    checkoutContextId,
    productIdentifier: product?.productId ?? "",
    paywallIdentifier: snapshot.paywall?.identifier,
    experimentVariantId: snapshot.experiment?.variantId,
    ...(eventName ? { presentedByEventName: eventName } : {}),
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

export const reprefetch = (paywall: PaywallSession): boolean => {
  if (!paywall.getSnapshot().device.publicApiKey) return false;
  const teleporter = teleportFor(paywall);
  if (teleporter.kind === "app" && teleporter.available()) return false;
  const mode = checkoutModeFor(paywall.getSnapshot());
  const targets = autoPrefetchTargets(paywall, mode);
  for (const reference of targets) {
    void prefetchSession(paywall, reference, mode);
  }
  return targets.length > 0;
};

const identities = new WeakMap<object, string>();

export const refreshIdentity = (paywall: PaywallSession, identity: string) => {
  const seen = identities.get(paywall);
  identities.set(paywall, identity);
  if (seen === undefined || seen === identity) return;
  invalidateSessions(paywall, "customer identity changed");
  reprefetch(paywall);
};

const warmedOpens = new WeakMap<object, object>();

export const warmOnOpen = (paywall: PaywallSession, open: object) => {
  if (warmedOpens.get(paywall) === open) return;
  if (reprefetch(paywall)) warmedOpens.set(paywall, open);
};

const scopeFor = (mode: CheckoutMode): SessionScope => {
  if (mode === "applePay") return "apple-pay";
  if (mode === "external") return "external";
  return "default";
};

export const prefetchSession = async (
  paywall: PaywallSession,
  referenceName: string,
  mode: CheckoutMode,
  prepaidCards?: SuperwallPrepaidCards,
): Promise<void> => {
  const sessions = sessionsFor(paywall);
  let result: CheckoutSessionResult | null;
  try {
    result = await sessions.prefetch({
      referenceName,
      mode,
      scope: scopeFor(mode),
      silent: true,
      ...(prepaidCards === undefined ? {} : { prepaidCards }),
    });
  } catch (error) {
    if (mode === "applePay")
      applePayFor(paywall).markUnavailable(referenceName, "session_failed", error);
    return;
  }
  if (!result) return;

  hostFor(paywall).prefetched(contextFor(paywall, referenceName, result.checkoutContextId));

  if (result.directive === "elements") {
    if (mode !== "applePay") return;
    const applePay = applePayFor(paywall);
    try {
      await applePay.prepare(result, sessions.identity());
    } catch (error) {
      applePay.markUnavailable(referenceName, "stripe_load_failed", error);
    }
    return;
  }
  if (result.directive === "embedded") {
    if (mode === "applePay") {
      applePayFor(paywall).markUnavailable(referenceName, "session_unsupported");
    }
    checkoutEvents.dispatch("SESSION_PREFETCHED", result);
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
  sessionsFor(paywall).invalidate();

  if (options.stripeMetadata) {
    try {
      await sessionsFor(paywall).attachMetadata(session.checkoutContextId, options.stripeMetadata);
    } catch (error) {
      console.error("Attaching checkout metadata failed:", error);
    }
  }

  let completion: WebappCompletion | undefined;
  if (hostOf() === "web-sdk" && bindsEntitlement(session.postPurchaseBehavior)) {
    try {
      completion = await sessionsFor(paywall).completeWebapp(session.checkoutContextId);
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
    completion,
  );

  const teleporter = teleportFor(paywall);
  if (teleporter.kind === "page") {
    await teleporter.completePurchase(session.checkoutContextId);
    return;
  }
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
): Promise<WebPurchaseOutcome> => {
  const sessions = sessionsFor(paywall);
  let failure: CheckoutFailure | undefined;
  const unpaid = (): WebPurchaseOutcome =>
    failure ? { status: "failed", failure } : { status: "abandoned" };

  for (let attempt = 0; attempt < STATUS_POLL_LIMIT; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL));
    const status = await sessions
      .status(redirect.checkoutContextId)
      .catch(() => ({ status: "pending" }) as const);

    if (status.status === "completed") {
      await reportCompletedCheckout(paywall, redirect, status.redemptionUrl);
      return { status: "completed" };
    }
    if ("failure" in status && status.failure) failure = status.failure;
    if (status.status === "abandoned") return unpaid();
  }

  console.warn("Gave up watching a hosted checkout after two minutes.");
  return unpaid();
};

export const openHostedCheckout = async (
  paywall: PaywallSession,
  redirect: RedirectCheckoutSession,
): Promise<WebPurchaseOutcome> => {
  const host = hostFor(paywall);
  host.initiated(contextFor(paywall, redirect.referenceName, redirect.checkoutContextId));

  if (!detectSuperwallHost()) {
    window.location.assign(redirect.checkoutUrl);
    return { status: "abandoned" };
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
  const warmed = sessionsFor(paywall).warmed(referenceName, "apple-pay");
  return applePayFor(paywall).purchase(
    referenceName,
    contextFor(paywall, referenceName, warmed?.checkoutContextId ?? ""),
  );
};

const sheetFailure = async (
  paywall: PaywallSession,
  embedded: EmbeddedCheckoutSession,
): Promise<CheckoutFailure> => {
  try {
    const status = await sessionsFor(paywall).status(embedded.checkoutContextId);
    return status.failure ?? unknownFailure();
  } catch (error) {
    console.warn("Looking up why the checkout failed did not work:", error);
    return unknownFailure();
  }
};

export const openEmbeddedSheet = (
  embedded: EmbeddedCheckoutSession,
  host?: { paywall: PaywallSession; referenceName: string; tappedAt?: number },
  onFailure?: (failure: CheckoutFailure) => void,
): Promise<WebPurchaseOutcome> =>
  new Promise((resolve) => {
    const events = host ? hostFor(host.paywall) : null;
    const context = host
      ? contextFor(host.paywall, host.referenceName, embedded.checkoutContextId)
      : null;
    let opened = false;
    let settled = false;
    let failed: Promise<CheckoutFailure> | null = null;
    const diagnostics =
      context && events
        ? checkoutDiagnostics.track(
            embedded.clientSecret,
            host?.tappedAt ?? Date.now(),
            (stage, ms, error) => events.diagnostic(context, stage, ms, error),
          )
        : null;

    const readyTimeout = setTimeout(() => {
      diagnostics?.timedOut();
      finish({ status: "failed", failure: unknownFailure() });
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
        finish({ status: "completed" });
      }),
      checkoutEvents.subscribe("PAYMENT_ERROR", ({ session: errored }) => {
        if (!isOurs(errored)) return;
        if (context) events?.failed(context);
        const lookup = host
          ? sheetFailure(host.paywall, embedded)
          : Promise.resolve(unknownFailure());
        failed = lookup;
        void lookup.then((failure) => {
          if (!settled && failed === lookup) onFailure?.(failure);
        });
      }),
      checkoutEvents.subscribe("SHEET_CLOSE", () => {
        if (!opened) return;
        if (failed) {
          finish(failed.then((failure) => ({ status: "failed", failure })));
          return;
        }
        if (context) events?.abandoned(context);
        finish({ status: "abandoned" });
      }),
    ];

    const finish = (outcome: WebPurchaseOutcome | Promise<WebPurchaseOutcome>) => {
      settled = true;
      clearTimeout(readyTimeout);
      stopLoading();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      resolve(outcome);
    };

    startLoading();
    checkoutEvents.dispatch("SESSION_CREATED", embedded);
  });

export const purchaseOnWeb = async (
  paywall: PaywallSession,
  referenceName: string,
  requested: CheckoutMode,
  options: WebPurchaseOptions = {},
): Promise<WebPurchaseOutcome> => {
  clearWebFailure(paywall);
  const events = purchaseEventsFor(paywall);
  events.emit("start", { referenceName });
  const stopWatching = checkoutEvents.subscribe("CHECKOUT_SUBMITTED", ({ session }) => {
    if (session.referenceName === referenceName) events.emit("submit", { referenceName });
  });
  let reported: CheckoutFailure | undefined;
  const reportFailure = (failure: CheckoutFailure) => {
    reported = failure;
    recordWebFailure(paywall, referenceName, failure);
    events.emit("failure", { referenceName, failure });
  };
  const outcome = await runWebPurchase(
    paywall,
    referenceName,
    requested,
    options,
    reportFailure,
  ).finally(stopWatching);
  if (outcome.status === "failed") {
    if (outcome.failure !== reported) reportFailure(outcome.failure);
  } else if (outcome.status === "completed") {
    clearWebFailure(paywall);
    events.emit("complete", { referenceName });
  } else events.emit("abandon", { referenceName });
  return outcome;
};

const runWebPurchase = async (
  paywall: PaywallSession,
  referenceName: string,
  requested: CheckoutMode,
  options: WebPurchaseOptions,
  onFailure: (failure: CheckoutFailure) => void,
): Promise<WebPurchaseOutcome> => {
  const tappedAt = Date.now();
  const sessions = sessionsFor(paywall);
  const mode = checkoutModeFor(paywall.getSnapshot(), requested);
  rememberPurchaseOptions(paywall, referenceName, options);
  try {
    if (mode === "applePay") {
      const outcome = await purchaseWithApplePay(paywall, referenceName);
      if (outcome.status !== "unavailable") return outcome;
    }

    const warmed =
      mode === "applePay"
        ? sessions.warmed(referenceName, "apple-pay", options.prepaidCards)
        : null;
    const result =
      warmed?.directive === "embedded"
        ? warmed
        : await sessions.begin({
            referenceName,
            mode: mode === "external" ? "external" : "sheet",
            scope: mode === "external" ? "external" : "default",
            ...(options.prepaidCards === undefined ? {} : { prepaidCards: options.prepaidCards }),
          });

    if (result.directive === "embedded") {
      return await openEmbeddedSheet(result, { paywall, referenceName, tappedAt }, onFailure);
    }
    if (result.directive === "redirect") return await openHostedCheckout(paywall, result);
    return { status: "failed", failure: unknownFailure() };
  } catch (error) {
    console.error("Error beginning web checkout:", error);
    return { status: "failed", failure: unknownFailure() };
  }
};

export type WebFailure = { referenceName: string; failure: CheckoutFailure };

const webFailures = new WeakMap<object, WebFailure>();
const webFailureListeners = new WeakMap<object, Set<() => void>>();

const notifyWebFailure = (paywall: PaywallSession) => {
  for (const listener of webFailureListeners.get(paywall) ?? []) listener();
};

const recordWebFailure = (
  paywall: PaywallSession,
  referenceName: string,
  failure: CheckoutFailure,
) => {
  webFailures.set(paywall, { referenceName, failure });
  notifyWebFailure(paywall);
};

export const clearWebFailure = (paywall: PaywallSession) => {
  if (!webFailures.delete(paywall)) return;
  notifyWebFailure(paywall);
};

export const lastWebFailure = (paywall: PaywallSession): WebFailure | undefined =>
  webFailures.get(paywall);

export const subscribeWebFailure = (paywall: PaywallSession, listener: () => void) => {
  const listeners = webFailureListeners.get(paywall) ?? new Set<() => void>();
  webFailureListeners.set(paywall, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const CUSTOM_STORE_NAVIGATION_DELAY = 250;

export const purchaseCustomStoreOnWeb = async (
  paywall: PaywallSession,
  referenceName: string,
  options: Pick<WebPurchaseOptions, "postPurchase"> = {},
): Promise<PurchaseOutcome> => {
  const snapshot = paywall.getSnapshot();
  const product = snapshot.productsByReference[referenceName];
  const productIdentifier = product?.productId ?? referenceName;
  const host = hostFor(paywall);
  const fail = (message: string, error?: unknown): PurchaseOutcome => {
    console.error(`[superwall] ${message}`, error ?? "");
    host.customFailed(productIdentifier, message);
    return "failed";
  };

  if (hostOf() === "web-sdk")
    return fail("Custom store products aren't supported in the Web SDK yet");
  if (!product) return fail(`No product "${referenceName}" on this paywall`);
  if (!asString(snapshot.device.publicApiKey)) {
    return fail("Cannot start a custom store checkout: the host sent no public API key");
  }

  const release = claimCustomStoreCheckout(paywall);
  if (!release) return "abandoned";

  let session: Awaited<ReturnType<typeof requestCustomStoreSession>>;
  try {
    startLoading();
    session = await requestCustomStoreSession(snapshot, product);
  } catch (error) {
    release();
    stopLoading();
    return fail(error instanceof Error ? error.message : "Custom store checkout failed", error);
  }

  const value = Number(product.variables.rawPrice);
  saveCustomStoreReturnRecord({
    version: 1,
    checkoutContextId: session.checkoutContextId,
    paywallUrl: window.location.href,
    productReference: referenceName,
    productIdentifier,
    customTransactionId: session.customTransactionId,
    ...(Number.isFinite(value) && value > 0
      ? { price: { value, currency: String(product.variables.currencyCode || "USD") } }
      : {}),
    resolution: resolutionOf(options.postPurchase ?? snapshot.config?.postPurchase) ?? {
      type: "default",
    },
    buyer: session.buyer,
    createdAt: Date.now(),
  });
  host.customStarted(productIdentifier, session.checkoutContextId, session.customTransactionId);

  const resetOnRestore = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    release();
    stopLoading();
    window.removeEventListener("pageshow", resetOnRestore);
  };
  window.addEventListener("pageshow", resetOnRestore);
  await new Promise((resolve) => setTimeout(resolve, CUSTOM_STORE_NAVIGATION_DELAY));
  window.location.assign(session.checkoutUrl);
  return "abandoned";
};

const clearRestoredLoader = (event: PageTransitionEvent) => {
  if (event.persisted) stopLoading();
};

export type TeleportPage = PaywallSession &
  Pick<SuperwallSession, "accept" | "setUserAttributes" | "on">;

const applyIntroductoryOffer = (paywall: TeleportPage, eligible: boolean) =>
  paywall.accept([
    { event_name: "template_substitutions_prefix", prefix: eligible ? "freeTrial" : "default" },
  ]);

export const followTeleportPage = (paywall: TeleportPage): (() => void) => {
  const boot = readTeleportBoot();
  if (boot === undefined) return () => undefined;
  let eligible = boot.hasIntroductoryOffer;
  const holdOffer = () => {
    if (eligible === undefined) return;
    if (paywall.getSnapshot().introductoryOffer.eligible !== eligible) {
      applyIntroductoryOffer(paywall, eligible);
    }
  };
  const email = boot.email;
  const fillEmail = () => {
    if (email !== undefined && asString(paywall.getSnapshot().user.email) === "") {
      paywall.setUserAttributes({ email });
    }
  };
  holdOffer();
  if (Object.keys(paywall.getSnapshot().variables).length > 0) fillEmail();
  const unsubscribers = [
    paywall.on("template_substitutions_prefix", holdOffer),
    paywall.on("template_variables", fillEmail),
  ];
  const followOffer = () => {
    const next = introductoryOfferFromFragment();
    if (next === undefined || next === eligible) return;
    eligible = next;
    applyIntroductoryOffer(paywall, next);
    invalidateSessions(paywall, "introductory offer changed");
    reprefetch(paywall);
  };
  window.addEventListener("hashchange", followOffer);
  window.addEventListener("pageshow", clearRestoredLoader);
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    window.removeEventListener("hashchange", followOffer);
    window.removeEventListener("pageshow", clearRestoredLoader);
  };
};
