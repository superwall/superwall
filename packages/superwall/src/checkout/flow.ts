import type {
  SuperwallPostPurchase,
  SuperwallPrepaidCards,
  SuperwallSession,
} from "@superwall/runtime";
import { checkoutPrefetchOf, detectSuperwallHost } from "@superwall/runtime";
import { createApplePay, type ApplePay, type ApplePayOutcome } from "./applePay";
import { createElementsCheckout, type CollectedPayment, type ElementsCheckout } from "./elements";
import { asString, field } from "./api/decode";
import { checkoutDiagnostics } from "./diagnostics";
import { fetchWithRetry } from "./api/fetch";
import { subscriptionsApiUrl } from "./api/url";
import {
  checkoutEvents,
  clearWebFailure,
  purchaseEventsFor,
  reportWebFailure,
  type PurchaseAttempt,
} from "./events";

export {
  clearWebFailure,
  dismissStoreFailure,
  isStoreFailureDismissed,
  lastWebFailure,
  subscribeWebFailure,
  type WebFailure,
} from "./events";
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
import { failureOfError, sameFailure, unknownFailure, type CheckoutFailure } from "./failure";
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

const DEFERRED_PREFETCH_LIMIT = 10;
const SHEET_READY_TIMEOUT = 10_000;
const STATUS_POLL_INTERVAL = 2_000;
const STATUS_POLL_LIMIT = 60;

export type PaywallSession = Pick<SuperwallSession, "getSnapshot" | "postMessage">;

const sessionsByPaywall = new WeakMap<object, CheckoutSessions>();
const applePayByPaywall = new WeakMap<object, ApplePay>();
const elementsByPaywall = new WeakMap<object, ElementsCheckout>();

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

export const elementsFor = (paywall: PaywallSession): ElementsCheckout => {
  const existing = elementsByPaywall.get(paywall);
  if (existing) return existing;
  const elements = createElementsCheckout({
    publicApiKey: () => String(paywall.getSnapshot().device.publicApiKey ?? ""),
    host: hostFor(paywall),
  });
  elementsByPaywall.set(paywall, elements);
  return elements;
};

const defersIntent = (mode: CheckoutMode): mode is "applePay" | "elements" =>
  mode === "applePay" || mode === "elements";

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
  elementsFor(paywall).clear();
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
  if (!defersIntent(mode)) return [preferred];
  return [preferred, ...stripeReferences.filter((reference) => reference !== preferred)].slice(
    0,
    DEFERRED_PREFETCH_LIMIT,
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
  if (defersIntent(mode)) return "elements";
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
  const elements = mode === "elements" ? elementsFor(paywall) : null;
  if (elements && elements.quoteOf(referenceName).status !== "ready") {
    elements.preparing(referenceName);
  }
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
    elements?.markUnavailable(referenceName, "session_failed", error);
    return;
  }
  if (!result) return;

  hostFor(paywall).prefetched(contextFor(paywall, referenceName, result.checkoutContextId));

  if (result.directive === "elements") {
    if (elements) {
      const current = elements.quoteOf(referenceName);
      if (
        current.status === "ready" &&
        current.quote.checkoutContextId === result.checkoutContextId
      )
        return;
      try {
        await elements.prepare(result, sessions.identity());
      } catch (error) {
        elements.markUnavailable(referenceName, "stripe_load_failed", error);
      }
      return;
    }
    if (mode !== "applePay") return;
    const applePay = applePayFor(paywall);
    try {
      await applePay.prepare(result, sessions.identity());
    } catch (error) {
      applePay.markUnavailable(referenceName, "stripe_load_failed", error);
    }
    return;
  }
  elements?.markUnavailable(referenceName, "session_unsupported");
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
  onFailure?: (failure: CheckoutFailure) => void,
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
    if ("failure" in status && status.failure) {
      if (!sameFailure(failure, status.failure)) {
        failure = status.failure;
        onFailure?.(failure);
      }
    }
    if (status.status === "abandoned") return unpaid();
  }

  console.warn("Gave up watching a hosted checkout after two minutes.");
  return unpaid();
};

export const openHostedCheckout = async (
  paywall: PaywallSession,
  redirect: RedirectCheckoutSession,
  onFailure?: (failure: CheckoutFailure) => void,
): Promise<WebPurchaseOutcome> => {
  const host = hostFor(paywall);
  host.initiated(contextFor(paywall, redirect.referenceName, redirect.checkoutContextId));

  if (!detectSuperwallHost()) {
    window.location.assign(redirect.checkoutUrl);
    return { status: "abandoned" };
  }

  host.openHostedPage(redirect.checkoutUrl);
  return watchHostedCheckout(paywall, redirect, onFailure);
};

export const watchCompletedCheckouts = (paywall: PaywallSession): (() => void) =>
  checkoutEvents.subscribe("PAYMENT_SUCCESS", ({ session }) => {
    void reportCompletedCheckout(paywall, session);
  });

export const purchaseWithApplePay = (
  paywall: PaywallSession,
  referenceName: string,
  onSubmit?: () => void,
): Promise<ApplePayOutcome> => {
  const warmed = sessionsFor(paywall).warmed(referenceName, "elements");
  return applePayFor(paywall).purchase(
    referenceName,
    contextFor(paywall, referenceName, warmed?.checkoutContextId ?? ""),
    onSubmit,
  );
};

export const SHEET_FAILURE_LOOKUP_TIMEOUT = 8_000;

const sheetFailure = async (
  paywall: PaywallSession,
  embedded: EmbeddedCheckoutSession,
): Promise<CheckoutFailure> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${SHEET_FAILURE_LOOKUP_TIMEOUT} ms`)),
      SHEET_FAILURE_LOOKUP_TIMEOUT,
    );
  });
  const status = await Promise.race([
    sessionsFor(paywall).status(embedded.checkoutContextId),
    timedOut,
  ]).catch((error: unknown) => {
    console.warn("Looking up why the checkout failed did not work:", error);
    return undefined;
  });
  clearTimeout(timer);
  return status?.failure ?? unknownFailure();
};

export const openEmbeddedSheet = (
  embedded: EmbeddedCheckoutSession,
  host?: { paywall: PaywallSession; referenceName: string; tappedAt?: number },
  onFailure?: (failure: CheckoutFailure) => void,
  onSubmit?: () => void,
): Promise<WebPurchaseOutcome> =>
  new Promise((resolve) => {
    const events = host ? hostFor(host.paywall) : null;
    const context = host
      ? contextFor(host.paywall, host.referenceName, embedded.checkoutContextId)
      : null;
    let opened = false;
    let paid = false;
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
        if (!isOurs(submitted)) return;
        onSubmit?.();
        if (context) events?.submitted(context);
      }),
      checkoutEvents.subscribe("PAYMENT_SUCCESS", ({ session: succeeded }) => {
        if (!isOurs(succeeded)) return;
        paid = true;
        finish({ status: "completed" });
      }),
      checkoutEvents.subscribe("PAYMENT_ERROR", ({ session: errored }) => {
        if (!isOurs(errored)) return;
        if (context) events?.failed(context);
        const looked = host
          ? sheetFailure(host.paywall, embedded)
          : Promise.resolve(unknownFailure());
        const earlier = failed;
        const lookup = earlier ? earlier.then(() => looked) : looked;
        failed = lookup;
        void lookup.then((failure) => {
          if (!paid) onFailure?.(failure);
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
      clearTimeout(readyTimeout);
      stopLoading();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      resolve(outcome);
    };

    startLoading();
    checkoutEvents.dispatch("SESSION_CREATED", embedded);
  });

type PurchaseReport = { onFailure: (failure: CheckoutFailure) => void; onSubmit: () => void };

const trackWebPurchase = async (
  paywall: PaywallSession,
  referenceName: string,
  attempt: PurchaseAttempt | undefined,
  run: (report: PurchaseReport) => Promise<WebPurchaseOutcome>,
): Promise<WebPurchaseOutcome> => {
  clearWebFailure(paywall);
  const events = purchaseEventsFor(paywall);
  events.emit("start", { referenceName, attempt });
  const reported = new Set<CheckoutFailure>();
  const reportFailure = (failure: CheckoutFailure) => {
    reported.add(failure);
    reportWebFailure(paywall, { referenceName, failure, attempt });
  };
  const outcome = await run({
    onFailure: reportFailure,
    onSubmit: () => events.emit("submit", { referenceName, attempt }),
  });
  if (outcome.status === "failed") {
    if (!reported.has(outcome.failure)) reportFailure(outcome.failure);
  } else if (outcome.status === "completed") {
    clearWebFailure(paywall);
    events.emit("complete", { referenceName, attempt });
  } else events.emit("abandon", { referenceName, attempt });
  return outcome;
};

export const purchaseOnWeb = (
  paywall: PaywallSession,
  referenceName: string,
  requested: CheckoutMode,
  options: WebPurchaseOptions = {},
  attempt?: PurchaseAttempt,
): Promise<WebPurchaseOutcome> =>
  trackWebPurchase(paywall, referenceName, attempt, (report) =>
    runWebPurchase(paywall, referenceName, requested, options, report),
  );

export type { CollectedPayment };

/**
 * Pays for a product with a payment method an `elements` form collected,
 * reporting the purchase exactly as Apple Pay and the sheet do. `collect`
 * runs once the purchase has started: it resolves the payment method, or
 * `null` when the shopper backed out, such as by closing a wallet.
 */
export const purchaseWithElements = (
  paywall: PaywallSession,
  referenceName: string,
  collect: () => Promise<CollectedPayment | null>,
  options: WebPurchaseOptions = {},
  attempt?: PurchaseAttempt,
): Promise<WebPurchaseOutcome> =>
  trackWebPurchase(paywall, referenceName, attempt, async (report) => {
    const elements = elementsFor(paywall);
    const state = elements.quoteOf(referenceName);
    if (state.status !== "ready") return { status: "failed", failure: unknownFailure() };
    rememberPurchaseOptions(paywall, referenceName, options);
    const host = hostFor(paywall);
    const context = contextFor(paywall, referenceName, state.quote.checkoutContextId);
    host.initiated(context);
    let collected: CollectedPayment | null;
    try {
      collected = await collect();
    } catch (error) {
      host.failed(context);
      return { status: "failed", failure: failureOfError(error) };
    }
    if (collected === null) {
      host.abandoned(context);
      return { status: "abandoned" };
    }
    return elements.pay(referenceName, collected, context, report.onSubmit);
  });

const runWebPurchase = async (
  paywall: PaywallSession,
  referenceName: string,
  requested: CheckoutMode,
  options: WebPurchaseOptions,
  report: PurchaseReport,
): Promise<WebPurchaseOutcome> => {
  const tappedAt = Date.now();
  const sessions = sessionsFor(paywall);
  const mode = checkoutModeFor(paywall.getSnapshot(), requested);
  rememberPurchaseOptions(paywall, referenceName, options);
  try {
    if (mode === "applePay") {
      const outcome = await purchaseWithApplePay(paywall, referenceName, report.onSubmit);
      if (outcome.status !== "unavailable") return outcome;
    }

    const warmed = defersIntent(mode)
      ? sessions.warmed(referenceName, "elements", options.prepaidCards)
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
      return await openEmbeddedSheet(
        result,
        { paywall, referenceName, tappedAt },
        report.onFailure,
        report.onSubmit,
      );
    }
    if (result.directive === "redirect")
      return await openHostedCheckout(paywall, result, report.onFailure);
    return { status: "failed", failure: unknownFailure() };
  } catch (error) {
    console.error("Error beginning web checkout:", error);
    return { status: "failed", failure: unknownFailure() };
  }
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
