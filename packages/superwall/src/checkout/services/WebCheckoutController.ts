import type { SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { fetchWithRetry, subscriptionsApiUrl } from "./api";
import { sessionCache } from "./SessionCache";
import type {
  CheckoutMode,
  CheckoutSessionCacheScope,
  CheckoutSessionResult,
  DiscountValidationResult,
} from "../state/types";

export const WEB_CHECKOUT_ELIGIBLE_STORES = ["stripe"];

export const isStripeProductIdentifier = (identifier: string | undefined): boolean =>
  typeof identifier === "string" && /^(test|live):price_[^:]+/.test(identifier);

type SnapshotSource = () => SuperwallRuntimeSnapshot;

type BeginOptions = {
  referenceName: string;
  mode: CheckoutMode;
  cacheScope?: CheckoutSessionCacheScope;
  silent?: boolean;
};

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);

const allowedDirectivesFor = (mode: CheckoutMode): readonly string[] =>
  mode === "external" ? ["redirect"] : ["embedded", "redirect"];

export class WebCheckoutController {
  private inFlight = new Map<string, Promise<CheckoutSessionResult>>();
  private cacheGeneration = 0;

  private appliedDiscountCode: string | null = null;

  onDiscountDropped: ((droppedCode: string) => void) | null = null;

  constructor(private getSnapshot: SnapshotSource) {}

  storeIsEligible = (store: string) => WEB_CHECKOUT_ELIGIBLE_STORES.includes(store);

  setDiscountCode(code: string | null) {
    this.appliedDiscountCode = code;
    this.clearSessionCache();
  }

  getDiscountCode() {
    return this.appliedDiscountCode;
  }

  validateDiscount = async ({
    code,
    productIdentifiers,
  }: {
    code: string;
    productIdentifiers: string[];
  }): Promise<DiscountValidationResult> => {
    const publicApiKey = asString(this.getSnapshot().device.publicApiKey);

    const response = await fetchWithRetry(subscriptionsApiUrl("checkout/discount"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${publicApiKey}`,
      },
      body: JSON.stringify({ code, store: "stripe", productIdentifiers }),
    });

    return (await response.json()) as DiscountValidationResult;
  };

  getCachedSession(referenceName: string, scope: CheckoutSessionCacheScope = "default") {
    return sessionCache.get(referenceName, scope);
  }

  clearSessionCache() {
    this.cacheGeneration++;
    sessionCache.clear();
    this.inFlight.clear();
  }

  isStripeProduct(referenceName: string): boolean {
    const product = this.getSnapshot().productsByReference[referenceName];
    return isStripeProductIdentifier(
      product?.productId ?? product?.productIdentifier ?? product?.id,
    );
  }

  beginCheckout = (options: BeginOptions): Promise<CheckoutSessionResult> => {
    const scope = options.cacheScope ?? "default";
    const requestKey = `${scope}:${options.referenceName}`;

    const existing = this.inFlight.get(requestKey);
    if (existing) return existing;

    const request = this.createSession({ ...options, cacheScope: scope });
    this.inFlight.set(requestKey, request);
    request.finally(() => this.inFlight.delete(requestKey));

    return request;
  };

  prefetchCheckout = async (options: BeginOptions): Promise<CheckoutSessionResult | null> => {
    const generation = this.cacheGeneration;

    if (!this.isStripeProduct(options.referenceName)) return null;

    try {
      const result = await this.beginCheckout({ ...options, silent: true });
      if (generation !== this.cacheGeneration) return null;
      if (!result.checkoutSessionId) return null;
      return result;
    } catch {
      return null;
    }
  };

  private createSession = async ({
    referenceName,
    mode,
    cacheScope = "default",
    silent = false,
  }: BeginOptions): Promise<CheckoutSessionResult> => {
    const generation = this.cacheGeneration;

    const cached = sessionCache.get(referenceName, cacheScope);
    if (cached) return cached;
    sessionCache.cleanupExpired();

    const snapshot = this.getSnapshot();
    const product = snapshot.productsByReference[referenceName];
    if (!product) {
      throw new Error(`No product named "${referenceName}" on this paywall.`);
    }

    const productIdentifier = product.productId ?? product.productIdentifier ?? product.id;
    if (!productIdentifier) {
      throw new Error(`Product "${referenceName}" has no store identifier.`);
    }

    const device = snapshot.device;
    const user = snapshot.user;
    const variables = product.variables;
    const publicApiKey = asString(device.publicApiKey);

    const identity = this.resolveIdentity();

    const body = {
      currencyCode: "USD",
      store: "stripe",
      productIdentifier,
      allowedCheckoutDirectives: allowedDirectivesFor(mode),
      shouldRespectIsFreeTrialAvailable: false,
      isPrefetch: silent,
      context: {
        paywall: {
          paywallId: snapshot.paywall?.id ?? "0",
          paywallIdentifier: snapshot.paywall?.identifier ?? "",
          paywallName: "",
          paywallUrl: typeof window === "undefined" ? "" : window.location.href,
          paywallProductIds: snapshot.products
            .map((entry) => entry.productId ?? entry.productIdentifier ?? "")
            .filter(Boolean)
            .join(","),
        },
        experiment: {
          experimentId: snapshot.experiment?.experimentId ?? "0",
          variantId: snapshot.experiment?.variantId ?? "0",
        },
        presentment: {
          isFreeTrialAvailable: snapshot.trial.eligible === true,
          presentedBy: "placement",
          presentationSourceType: "register",
          presentedByEventName: asString(snapshot.params.event_name),
        },
        placementParams: {
          placementParams: snapshot.params ?? {},
        },
        identity,
        device: {
          appInstallDate: asString(device.appInstallDate) || undefined,
          publicApiKey,
          platform: asString(device.platform) || "web",
          appVersion: asString(device.appVersion),
          osVersion: asString(device.osVersion),
          deviceModel: asString(device.deviceModel),
          deviceLocale: asString(device.deviceLocale),
          deviceLanguageCode: asString(device.deviceLanguageCode),
          deviceCurrencyCode: asString(device.deviceCurrencyCode),
          deviceCurrencySymbol: asString(device.deviceCurrencySymbol),
          timezoneOffset: asString(device.timezoneOffset),
        },
        product: {
          identifier: productIdentifier,
          currencyCode: variables.currencyCode || "USD",
          currencySymbol: variables.currencySymbol || "$",
          dailyPrice: variables.dailyPrice || "",
          weeklyPrice: variables.weeklyPrice || "",
          monthlyPrice: variables.monthlyPrice || "",
          yearlyPrice: variables.yearlyPrice || "",
          languageCode: variables.languageCode || "",
          locale: variables.locale || "",
          localizedPeriod: variables.localizedPeriod || "",
          period: variables.period || "",
          periodAlt: variables.periodAlt || "",
          periodDays: asNumber(variables.periodDays),
          periodWeeks: asNumber(variables.periodWeeks),
          periodMonths: asNumber(variables.periodMonths),
          periodYears: asNumber(variables.periodYears),
          periodly: variables.periodly || "",
          price: variables.price || "",
          rawPrice: asNumber(variables.rawPrice),
          rawTrialPeriodPrice: asNumber(variables.rawTrialPeriodPrice),
          trialPeriodDailyPrice: variables.trialPeriodDailyPrice || "",
          trialPeriodWeeklyPrice: variables.trialPeriodWeeklyPrice || "",
          trialPeriodMonthlyPrice: variables.trialPeriodMonthlyPrice || "",
          trialPeriodYearlyPrice: variables.trialPeriodYearlyPrice || "",
          trialPeriodPrice: variables.trialPeriodPrice || "",
          trialPeriodDays: asNumber(variables.trialPeriodDays),
          trialPeriodWeeks: asNumber(variables.trialPeriodWeeks),
          trialPeriodMonths: asNumber(variables.trialPeriodMonths),
          trialPeriodYears: asNumber(variables.trialPeriodYears),
          trialPeriodEndDate: variables.trialPeriodEndDate || "",
          trialPeriodText: variables.trialPeriodText || "",
        },
      },
      ...(typeof user.stripe_customer_id === "string" && user.stripe_customer_id.length > 0
        ? { stripeCustomerId: user.stripe_customer_id }
        : {}),
    };

    const requestSession = (promotionCode: string | null) =>
      fetchWithRetry(subscriptionsApiUrl("checkout/session"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicApiKey}`,
        },
        body: JSON.stringify(promotionCode ? { ...body, promotionCode } : body),
      });

    let response: Response;
    try {
      response = await requestSession(this.appliedDiscountCode);
    } catch (error) {
      const refusedCode =
        this.appliedDiscountCode &&
        error instanceof Error &&
        error.message.startsWith("Client error:");
      if (!refusedCode) throw error;

      const droppedCode = this.appliedDiscountCode as string;
      this.appliedDiscountCode = null;
      this.onDiscountDropped?.(droppedCode);
      response = await requestSession(null);
    }

    const data = (await response.json()) as {
      checkoutContextId: string;
      directive: Record<string, unknown> & { directive: string };
    };

    const result = this.toSessionResult(data, referenceName, silent);

    if (generation === this.cacheGeneration) {
      sessionCache.set(referenceName, result, cacheScope);
    }

    return result;
  };

  private toSessionResult(
    data: { checkoutContextId: string; directive: Record<string, unknown> & { directive: string } },
    referenceName: string,
    silent: boolean,
  ): CheckoutSessionResult {
    const { directive } = data;

    if (directive.directive === "embedded") {
      const checkoutSessionId = asString(directive.checkoutSessionId);
      const publishableKey = asString(directive.publishableKey);
      const clientSecret = asString(directive.clientSecret) || checkoutSessionId;

      if (!checkoutSessionId || !publishableKey) {
        throw new Error("Missing checkoutSessionId or publishableKey for embedded directive");
      }

      return {
        directive: "embedded",
        checkoutSessionId,
        clientSecret,
        publishableKey,
        checkoutContextId: data.checkoutContextId,
        referenceName,
        ...(silent ? { wasPrefetched: true } : {}),
      };
    }

    if (directive.directive === "redirect") {
      const checkoutSessionId = asString(directive.checkoutSessionId);
      const checkoutUrl = asString(directive.checkoutUrl);

      if (!checkoutSessionId || !checkoutUrl) {
        throw new Error("Missing checkoutSessionId or checkoutUrl for redirect directive");
      }

      return {
        directive: "redirect",
        checkoutSessionId,
        checkoutUrl,
        checkoutContextId: data.checkoutContextId,
        referenceName,
        ...(silent ? { wasPrefetched: true } : {}),
      };
    }

    throw new Error(`Invalid checkout session directive: ${directive.directive}`);
  }

  private resolveIdentity() {
    const snapshot = this.getSnapshot();
    const { user, device, params } = snapshot;

    const aliasId = typeof user.aliasId === "string" ? user.aliasId : null;
    const appUserId =
      asString(user.appUserId) ||
      asString(params.app_user_id) ||
      asString(params.user) ||
      asString(params.uid) ||
      asString(device.appUserId) ||
      aliasId ||
      `$SuperwallAlias:${crypto.randomUUID()}`;

    const platform = asString(device.platform).toLowerCase();
    const providedDeviceId = asString(device.deviceId);
    const vendorId = asString(device.vendorId);

    // Android reports a non-UUID vendorId, so its deviceId is the stable one.
    const rawDeviceId =
      platform === "android" ? providedDeviceId || vendorId : vendorId || providedDeviceId;
    const deviceIdValue = rawDeviceId || crypto.randomUUID();
    const deviceId = deviceIdValue.startsWith("$SuperwallDevice:")
      ? deviceIdValue
      : `$SuperwallDevice:${deviceIdValue}`;

    const email = typeof user.email === "string" && user.email.length > 0 ? user.email : null;

    return { appUserId, aliasId, deviceId, email };
  }
}
