import type { SuperwallPostPurchase } from "@superwall/runtime";

export type CheckoutMode = "sheet" | "external" | "applePay";

export type RedemptionCode = { code: string; claimed: boolean };

export type WebappCompletion = {
  entitlementsToken?: string;
  claimed?: boolean;
  redemptionCodes: RedemptionCode[];
};

export type PostPurchaseBehavior = "GRANT_ACCESS" | "REDIRECT" | "REDEEM" | "CUSTOM";

export type PostCheckoutResolution =
  | { type: "default" }
  | { type: "redeem" }
  | { type: "redirect"; url: string }
  | { type: "paywall" };

export type WebPurchaseOptions = {
  postPurchase?: SuperwallPostPurchase;
  stripeMetadata?: Readonly<Record<string, string>>;
};

export type SessionScope = "default" | "apple-pay";

export type SubscriptionDetails = {
  amount: number;
  amountDueNow?: number;
  currency: string;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
  trialPeriodDays?: number;
  productName?: string;
  discountedAmount?: number;
  discount?: AppliedDiscount;
};

export type EmbeddedCheckoutSession = {
  directive: "embedded";
  checkoutSessionId: string;
  clientSecret: string;
  publishableKey: string;
  checkoutContextId: string;
  referenceName: string;
  postPurchaseBehavior?: PostPurchaseBehavior;
  wasPrefetched?: boolean;
};

export type RedirectCheckoutSession = {
  directive: "redirect";
  checkoutSessionId: string;
  checkoutUrl: string;
  checkoutContextId: string;
  referenceName: string;
  postPurchaseBehavior?: PostPurchaseBehavior;
  wasPrefetched?: boolean;
};

export type ElementsCheckoutSession = {
  directive: "elements";
  checkoutSessionId: string | null;
  publishableKey: string;
  checkoutContextId: string;
  referenceName: string;
  subscriptionDetails: SubscriptionDetails;
  intentType?: "SetupIntent" | "PaymentIntent";
  stripeAccountCountryCode?: string;
  managementUrl?: string;
  postPurchaseBehavior?: PostPurchaseBehavior;
  wasPrefetched?: boolean;
};

export type CheckoutSessionResult =
  | EmbeddedCheckoutSession
  | RedirectCheckoutSession
  | ElementsCheckoutSession;

export type ApplePaySession = {
  directive: "applePay";
  referenceName: string;
  checkoutContextId: string;
  checkoutSessionId: string | null;
  postPurchaseBehavior?: PostPurchaseBehavior;
};

export type PaymentSession = EmbeddedCheckoutSession | ApplePaySession;

export type AppliedDiscount = {
  code: string;
  promotionCodeId: string;
  couponId: string;
  name?: string | null;
  percentOff?: number | null;
  amountOff?: number | null;
  currency?: string | null;
  duration?: "forever" | "once" | "repeating";
  durationInMonths?: number | null;
  firstTimeTransactionOnly?: boolean;
};

export type DiscountedProductPrice = {
  productIdentifier: string;
  applies: boolean;
  originalAmount: number;
  discountedAmount: number;
  currency: string;
  interval?: "day" | "week" | "month" | "year";
  intervalCount?: number;
  productName?: string;
};

export type DiscountValidationResult =
  | { valid: true; discount: AppliedDiscount; products: DiscountedProductPrice[] }
  | { valid: false; reason: string };

export type PurchaseOutcome = "completed" | "abandoned" | "failed";

export type CheckoutStatus = {
  status: "pending" | "completed" | "abandoned";
  redemptionUrl?: string;
};

export type CustomerIdentity = {
  email?: string;
  stripeCustomerId?: string;
};
