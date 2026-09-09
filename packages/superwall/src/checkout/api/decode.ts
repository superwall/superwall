import { decodeCheckoutSessionId } from "../session/id";
import type {
  AppliedDiscount,
  CheckoutStatus,
  PostPurchaseBehavior,
  CheckoutSessionResult,
  DiscountedProductPrice,
  DiscountValidationResult,
  SubscriptionDetails,
} from "../types";

export const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

export const asString = (value: unknown): string =>
  typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);

export const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const nullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const INTERVALS = ["day", "week", "month", "year"] as const;

const intervalOf = (value: unknown): SubscriptionDetails["interval"] | undefined =>
  INTERVALS.find((interval) => interval === value);

const DURATIONS = ["forever", "once", "repeating"] as const;

const durationOf = (value: unknown): AppliedDiscount["duration"] | undefined =>
  DURATIONS.find((duration) => duration === value);

const POST_PURCHASE_BEHAVIORS = ["GRANT_ACCESS", "REDIRECT", "REDEEM", "CUSTOM"] as const;

const postPurchaseBehaviorOf = (value: unknown): PostPurchaseBehavior | undefined =>
  POST_PURCHASE_BEHAVIORS.find((behavior) => behavior === value);

const INTENT_TYPES = ["SetupIntent", "PaymentIntent"] as const;

export const intentTypeOf = (value: unknown): "SetupIntent" | "PaymentIntent" | undefined =>
  INTENT_TYPES.find((intent) => intent === value);

const withDefined = <T extends object>(value: T): T => {
  for (const key of Object.keys(value)) {
    if (Reflect.get(value, key) === undefined) Reflect.deleteProperty(value, key);
  }
  return value;
};

export const readAppliedDiscount = (value: unknown): AppliedDiscount | null => {
  const code = asString(field(value, "code"));
  const promotionCodeId = asString(field(value, "promotionCodeId"));
  const couponId = asString(field(value, "couponId"));
  if (!code || !promotionCodeId || !couponId) return null;
  const firstTimeTransactionOnly = field(value, "firstTimeTransactionOnly");
  return withDefined({
    code,
    promotionCodeId,
    couponId,
    name: nullableString(field(value, "name")),
    percentOff: nullableNumber(field(value, "percentOff")),
    amountOff: nullableNumber(field(value, "amountOff")),
    currency: nullableString(field(value, "currency")),
    duration: durationOf(field(value, "duration")),
    durationInMonths: nullableNumber(field(value, "durationInMonths")),
    firstTimeTransactionOnly:
      typeof firstTimeTransactionOnly === "boolean" ? firstTimeTransactionOnly : undefined,
  });
};

export const readDiscountedPrice = (value: unknown): DiscountedProductPrice | null => {
  const productIdentifier = asString(field(value, "productIdentifier"));
  const currency = asString(field(value, "currency"));
  if (!productIdentifier || !currency) return null;
  return withDefined({
    productIdentifier,
    applies: field(value, "applies") === true,
    originalAmount: asNumber(field(value, "originalAmount")),
    discountedAmount: asNumber(field(value, "discountedAmount")),
    currency,
    interval: intervalOf(field(value, "interval")),
    intervalCount: optionalNumber(field(value, "intervalCount")),
    productName: optionalString(field(value, "productName")),
  });
};

export const readDiscountValidation = (value: unknown): DiscountValidationResult => {
  if (field(value, "valid") !== true) {
    return { valid: false, reason: asString(field(value, "reason")) || "invalid_code" };
  }
  const discount = readAppliedDiscount(field(value, "discount"));
  if (!discount) return { valid: false, reason: "malformed_discount" };
  const rawProducts = field(value, "products");
  const products = Array.isArray(rawProducts)
    ? rawProducts.map(readDiscountedPrice).filter((price) => price !== null)
    : [];
  return { valid: true, discount, products };
};

export const readSubscriptionDetails = (value: unknown): SubscriptionDetails | null => {
  const currency = asString(field(value, "currency"));
  const interval = intervalOf(field(value, "interval"));
  if (!currency || !interval) return null;
  const discount = readAppliedDiscount(field(value, "discount"));
  return withDefined({
    amount: asNumber(field(value, "amount")),
    amountDueNow: optionalNumber(field(value, "amountDueNow")),
    currency,
    interval,
    intervalCount: asNumber(field(value, "intervalCount")) || 1,
    trialPeriodDays: optionalNumber(field(value, "trialPeriodDays")),
    productName: optionalString(field(value, "productName")),
    discountedAmount: optionalNumber(field(value, "discountedAmount")),
    discount: discount ?? undefined,
  });
};

export const readCheckoutSession = (
  body: unknown,
  referenceName: string,
  silent: boolean,
): CheckoutSessionResult => {
  const checkoutContextId = asString(field(body, "checkoutContextId"));
  const directive = field(body, "directive");
  const kind = asString(field(directive, "directive"));
  const behavior = postPurchaseBehaviorOf(field(body, "postPurchaseBehavior"));
  const common = {
    checkoutContextId,
    referenceName,
    ...(behavior ? { postPurchaseBehavior: behavior } : {}),
    ...(silent ? { wasPrefetched: true as const } : {}),
  };

  if (kind === "elements") {
    const publishableKey = asString(field(directive, "publishableKey"));
    const subscriptionDetails = readSubscriptionDetails(field(directive, "subscriptionDetails"));
    if (!publishableKey || !subscriptionDetails) {
      throw new Error("Missing publishableKey or subscriptionDetails for elements directive");
    }
    const intentType = intentTypeOf(field(directive, "intentType"));
    const stripeAccountCountryCode = field(directive, "stripeAccountCountryCode");
    const managementUrl = field(directive, "managementUrl");
    return {
      directive: "elements",
      checkoutSessionId: asString(field(directive, "checkoutSessionId")) || null,
      publishableKey,
      subscriptionDetails,
      ...(intentType ? { intentType } : {}),
      ...(typeof stripeAccountCountryCode === "string" ? { stripeAccountCountryCode } : {}),
      ...(typeof managementUrl === "string" ? { managementUrl } : {}),
      ...common,
    };
  }

  if (kind === "embedded") {
    const checkoutSessionId = asString(field(directive, "checkoutSessionId"));
    const publishableKey = asString(field(directive, "publishableKey"));
    if (!checkoutSessionId || !publishableKey) {
      throw new Error("Missing checkoutSessionId or publishableKey for embedded directive");
    }
    return {
      directive: "embedded",
      checkoutSessionId,
      clientSecret:
        asString(field(directive, "clientSecret")) ||
        decodeCheckoutSessionId(checkoutSessionId) ||
        checkoutSessionId,
      publishableKey,
      ...common,
    };
  }

  if (kind === "redirect") {
    const checkoutSessionId = asString(field(directive, "checkoutSessionId"));
    const checkoutUrl = asString(field(directive, "checkoutUrl"));
    if (!checkoutSessionId || !checkoutUrl) {
      throw new Error("Missing checkoutSessionId or checkoutUrl for redirect directive");
    }
    return {
      directive: "redirect",
      checkoutSessionId,
      checkoutUrl,
      ...common,
    };
  }

  throw new Error(`Invalid checkout session directive: ${kind}`);
};

const CHECKOUT_STATUSES = ["pending", "completed", "abandoned"] as const;

export const readCheckoutStatus = (body: unknown): CheckoutStatus => {
  const status = CHECKOUT_STATUSES.find((candidate) => candidate === field(body, "status"));
  const redemptionUrl = field(body, "redemptionUrl");
  return {
    status: status ?? "pending",
    ...(typeof redemptionUrl === "string" && redemptionUrl !== "" ? { redemptionUrl } : {}),
  };
};

export const errorMessageOf = (body: unknown, fallback: string): string => {
  const nested = field(field(body, "error"), "message");
  if (typeof nested === "string") return nested;
  for (const key of ["message", "detail", "title"]) {
    const message = field(body, key);
    if (typeof message === "string") return message;
  }
  return fallback;
};
