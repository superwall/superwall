import type { SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { createSessionCache, type SessionCache } from "./cache";
import { sessionBody } from "../api/body";
import {
  asString,
  field,
  readCheckoutSession,
  readCheckoutStatus,
  readDiscountValidation,
} from "../api/decode";
import { fetchWithRetry } from "../api/fetch";
import { attachCheckoutMetadata } from "../api/metadata";
import { subscriptionsApiUrl } from "../api/url";
import { createDiscountStore, type DiscountStore } from "../discount/store";
import { bareProductIdentifier, isStripeProductIdentifier } from "../products";
import { readTeleportBoot } from "../teleport/boot";
import type {
  CheckoutMode,
  CheckoutSessionResult,
  CheckoutStatus,
  CustomerIdentity,
  DiscountValidationResult,
  SessionScope,
  WebappCompletion,
} from "../types";

export const MAX_DISCOUNT_PRODUCTS = 20;

export type SessionRequest = {
  referenceName: string;
  mode: CheckoutMode;
  scope?: SessionScope;
  silent?: boolean;
};

export type CheckoutSessions = {
  readonly discounts: DiscountStore;
  readonly cache: SessionCache;
  isStripeProduct(referenceName: string): boolean;
  identity(): CustomerIdentity;
  begin(request: SessionRequest): Promise<CheckoutSessionResult>;
  prefetch(request: SessionRequest): Promise<CheckoutSessionResult | null>;
  status(checkoutContextId: string): Promise<CheckoutStatus>;
  redeemDiscount(code: string): Promise<DiscountValidationResult>;
  clearDiscount(): void;
  attachMetadata(
    checkoutContextId: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void>;
  completeWebapp(checkoutContextId: string): Promise<WebappCompletion>;
  invalidate(): void;
};

export const createCheckoutSessions = (
  getSnapshot: () => SuperwallRuntimeSnapshot,
): CheckoutSessions => {
  const discounts = createDiscountStore();
  const cache = createSessionCache();
  const inFlight = new Map<string, Promise<CheckoutSessionResult>>();
  let generation = 0;

  const headers = (): HeadersInit => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${asString(getSnapshot().device.publicApiKey)}`,
  });

  const invalidate = () => {
    generation++;
    cache.clear();
    inFlight.clear();
  };

  const isStripeProduct = (referenceName: string) =>
    isStripeProductIdentifier(getSnapshot().productsByReference[referenceName]?.productId);

  const validateDiscount = async (body: {
    code: string;
    productIdentifiers: string[];
  }): Promise<DiscountValidationResult> => {
    const response = await fetchWithRetry(subscriptionsApiUrl("checkout/discount"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...body, store: "stripe" }),
    });
    return readDiscountValidation(await response.json());
  };

  const create = async ({
    referenceName,
    mode,
    scope = "default",
    silent = false,
  }: SessionRequest): Promise<CheckoutSessionResult> => {
    const asked = generation;

    const cached = cache.get(referenceName, scope);
    if (cached) return cached;
    cache.cleanupExpired();

    const snapshot = getSnapshot();
    const product = snapshot.productsByReference[referenceName];
    if (!product) throw new Error(`No product named "${referenceName}" on this paywall.`);
    if (!product.productId) {
      throw new Error(`Product "${referenceName}" has no store identifier.`);
    }

    const body = sessionBody({
      snapshot,
      product,
      productIdentifier: bareProductIdentifier(product.productId),
      mode,
      silent,
      teleportId: readTeleportBoot()?.id,
    });

    const request = (promotionCode: string | null) =>
      fetchWithRetry(subscriptionsApiUrl("checkout/session"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(promotionCode ? { ...body, promotionCode } : body),
      });

    const promotionCode = discounts.codeFor(product.productId);

    let response: Response;
    try {
      response = await request(promotionCode);
    } catch (error) {
      const refused =
        promotionCode !== null &&
        error instanceof Error &&
        error.message.startsWith("Client error:");
      if (!refused) throw error;

      discounts.drop(promotionCode);
      response = await request(null);
    }

    const result = readCheckoutSession(await response.json(), referenceName, silent);
    if (asked === generation) cache.set(referenceName, result, scope);
    return result;
  };

  const begin = (request: SessionRequest): Promise<CheckoutSessionResult> => {
    const scope = request.scope ?? "default";
    const key = `${scope}:${request.referenceName}`;

    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = create({ ...request, scope });
    inFlight.set(key, pending);
    const release = () => inFlight.delete(key);
    void pending.then(release, release);

    return pending;
  };

  return {
    discounts,
    cache,
    isStripeProduct,
    identity: () => {
      const { user } = getSnapshot();
      return {
        ...(typeof user.email === "string" && user.email.length > 0 ? { email: user.email } : {}),
        ...(typeof user.stripe_customer_id === "string" && user.stripe_customer_id.length > 0
          ? { stripeCustomerId: user.stripe_customer_id }
          : {}),
      };
    },
    begin,
    prefetch: async (request) => {
      const asked = generation;
      if (!isStripeProduct(request.referenceName)) return null;
      if (!getSnapshot().device.publicApiKey) return null;
      try {
        const result = await begin({ ...request, silent: true });
        return asked === generation ? result : null;
      } catch {
        return null;
      }
    },
    status: async (checkoutContextId) => {
      const response = await fetchWithRetry(subscriptionsApiUrl("checkout/status"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ checkoutId: checkoutContextId }),
      });
      return readCheckoutStatus(await response.json());
    },
    redeemDiscount: async (code) => {
      const trimmed = code.trim();
      if (!trimmed) return { valid: false, reason: "empty_code" };

      const productIdentifiers = getSnapshot()
        .products.map((product) => product.productId)
        .filter((identifier): identifier is string => isStripeProductIdentifier(identifier))
        .map(bareProductIdentifier)
        .slice(0, MAX_DISCOUNT_PRODUCTS);
      if (productIdentifiers.length === 0) return { valid: false, reason: "no_stripe_products" };

      const result = await validateDiscount({ code: trimmed, productIdentifiers });
      if (!result.valid) return result;
      if (!result.products.some((product) => product.applies)) {
        return { valid: false, reason: "no_applicable_products" };
      }

      discounts.apply(trimmed, result.discount, result.products);
      invalidate();
      return result;
    },
    clearDiscount: () => {
      if (discounts.clear()) invalidate();
    },
    attachMetadata: (checkoutContextId, metadata) =>
      attachCheckoutMetadata(
        asString(getSnapshot().device.publicApiKey),
        checkoutContextId,
        metadata,
      ),
    completeWebapp: async (checkoutContextId) => {
      const response = await fetchWithRetry(
        subscriptionsApiUrl("checkout/session/complete-webapp"),
        { method: "POST", headers: headers(), body: JSON.stringify({ checkoutContextId }) },
      );
      const body: unknown = await response.json();
      const text = (key: string) => {
        const value = field(body, key);
        return typeof value === "string" && value !== "" ? value : undefined;
      };
      const claimedCode = text("claimedRedemptionCode");
      const unclaimedCode = text("redemptionCode");
      const claimed = field(body, "claimed");
      const entitlementsToken = text("entitlementsToken");
      return {
        ...(entitlementsToken ? { entitlementsToken } : {}),
        ...(typeof claimed === "boolean" ? { claimed } : {}),
        redemptionCodes: [
          ...(claimedCode ? [{ code: claimedCode, claimed: true }] : []),
          ...(unclaimedCode ? [{ code: unclaimedCode, claimed: false }] : []),
        ],
      };
    },
    invalidate,
  };
};
