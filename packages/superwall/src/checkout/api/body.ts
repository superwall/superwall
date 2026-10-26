import {
  checkoutManagedPaymentsOf,
  type SuperwallProduct,
  type SuperwallRuntimeSnapshot,
} from "@superwall/runtime";
import { presentingPlacement } from "../host/init";
import { asNumber, asString } from "./decode";
import type { CheckoutMode } from "../types";

export const allowedDirectivesFor = (mode: CheckoutMode): readonly string[] => {
  switch (mode) {
    case "external":
      return ["redirect"];
    case "applePay":
      return ["elements", "embedded", "redirect"];
    case "sheet":
      return ["embedded", "redirect"];
  }
};

export type SessionIdentity = {
  appUserId: string;
  aliasId: string | null;
  deviceId: string;
  email: string | null;
};

export const identityOf = (snapshot: SuperwallRuntimeSnapshot): SessionIdentity => {
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
};

export type SessionBodyOptions = {
  snapshot: SuperwallRuntimeSnapshot;
  product: SuperwallProduct;
  productIdentifier: string;
  mode: CheckoutMode;
  silent: boolean;
  teleportId?: string;
};

export const attributionOf = (
  snapshot: SuperwallRuntimeSnapshot,
  { freeTrial = snapshot.introductoryOffer.eligible === true }: { freeTrial?: boolean } = {},
) => {
  const { device, params } = snapshot;
  const placement = presentingPlacement(params);
  return {
    paywall: {
      paywallId: snapshot.paywall?.id ?? "0",
      paywallIdentifier: snapshot.paywall?.identifier ?? "",
      paywallName: "",
      paywallUrl: window.location.href,
      paywallProductIds: snapshot.products
        .map((entry) => entry.productId ?? "")
        .filter(Boolean)
        .join(","),
    },
    experiment: {
      experimentId: snapshot.experiment?.experimentId ?? "0",
      variantId: snapshot.experiment?.variantId ?? "0",
    },
    presentment: {
      isFreeTrialAvailable: freeTrial,
      presentedBy: "placement",
      presentationSourceType: "register",
      presentedByEventName: placement.name,
      presentedByEventId: placement.eventId || crypto.randomUUID(),
      presentedByEventTimestamp: new Date().toISOString(),
    },
    placementParams: {
      placementParams: params,
    },
    identity: identityOf(snapshot),
    device: {
      appInstallDate: asString(device.appInstallDate) || undefined,
      publicApiKey: asString(device.publicApiKey),
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
  };
};

export const sessionBody = ({
  snapshot,
  product,
  productIdentifier,
  mode,
  silent,
  teleportId,
}: SessionBodyOptions) => {
  const { user } = snapshot;
  const variables = product.variables;
  const managedPayments = checkoutManagedPaymentsOf(snapshot.config?.checkout);

  return {
    currencyCode: "USD",
    store: "stripe",
    productIdentifier,
    allowedCheckoutDirectives: allowedDirectivesFor(mode),
    shouldRespectIsFreeTrialAvailable: false,
    isPrefetch: silent,
    deferElementsIntentCreation: mode === "applePay",
    ...(teleportId === undefined ? {} : { teleportId }),
    context: {
      ...attributionOf(snapshot),
      ...(managedPayments === undefined ? {} : { paywallManagedPaymentsOverride: managedPayments }),
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
};
