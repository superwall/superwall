import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { CommandContext } from "@/program/command";
import { pickScope } from "@/core/account/scope";
import type { SuperwallApi } from "@/core/api/client";
import { listResource, type Row } from "@/core/api/resources";
import { isRecord } from "@/core/json";
import { formatJson } from "@/program/output";
import { apiCall } from "@/ui/spinner";
import { textOf } from "./input";

export async function writeStoreKit(context: CommandContext, api: SuperwallApi, out: unknown): Promise<void> {
  const scope = await pickScope(context, api, false);
  const products = await apiCall(context, "Loading products", () =>
    listResource(api, "products", scope),
  );
  const outFile = textOf(out) ?? "Superwall.storekit";
  const { file, counts, unpriced, skipped } = buildStoreKit(products, { groupName: scope.appName ?? scope.projectName });
  writeFileSync(outFile, `${formatJson(file)}\n`);
  if (context.json) {
    return context.output.data({
      path: outFile,
      products: counts.total,
      subscriptions: counts.subscriptions,
      ...(unpriced.length ? { unpriced } : {}),
      ...(skipped.length ? { skipped } : {}),
    });
  }
  context.ui.success(
    `Wrote \`${outFile}\` with ${counts.total} product${counts.total === 1 ? "" : "s"}` +
      (counts.subscriptions ? `, ${counts.subscriptions} of them auto-renewable` : ""),
  );
  if (unpriced.length) {
    context.ui.warn(`Superwall has no price for ${unpriced.join(", ")}: written at 0.00, so set it in Xcode.`);
  }
  if (skipped.length) {
    context.ui.info(`Left out ${skipped.length} product${skipped.length === 1 ? "" : "s"} of other stores: ${skipped.join(", ")}.`);
  }
}

/** The StoreKit configuration file format as Xcode 26 writes it (`version` 5.0). */
const STOREKIT_VERSION = { major: 5, minor: 0 } as const;
const LOCALE = "en_US";
const STORE_KIT_ERRORS = [
  "Load Products",
  "Purchase",
  "Verification",
  "App Store Sync",
  "Subscription Status",
  "App Transaction",
  "Manage Subscriptions Sheet",
  "Refund Request Sheet",
  "Offer Code Redeem Sheet",
];

type ProductType = "RecurringSubscription" | "NonRenewingSubscription" | "Consumable" | "NonConsumable";
type PaymentMode = "free" | "payAsYouGo" | "payUpFront";
type PeriodUnit = "day" | "week" | "month" | "year";

export interface StoreKitBuild {
  file: Record<string, unknown>;
  counts: { total: number; subscriptions: number };
  /** Products Superwall has no price for, written at 0.00. */
  unpriced: string[];
  /** Products of another store (Play Store, Stripe, ...), left out. */
  skipped: string[];
}

export function generateStoreKit(products: Row[], options: { groupName?: string } = {}): Record<string, unknown> {
  return buildStoreKit(products, options).file;
}

/**
 * Superwall's products as an Xcode StoreKit configuration: auto-renewables in one subscription
 * group (Superwall doesn't know App Store Connect's groups or levels), everything else in
 * `products` or `nonRenewingSubscriptions`. Products of other stores are left out.
 */
export function buildStoreKit(products: Row[], options: { groupName?: string } = {}): StoreKitBuild {
  const groupName = options.groupName?.trim() || "Subscriptions";
  const groupId = internalId("group", groupName);
  const oneTime: Record<string, unknown>[] = [];
  const nonRenewing: Record<string, unknown>[] = [];
  const subscriptions: Record<string, unknown>[] = [];
  const unpriced: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const product of products) {
    const id = identifierOf(product);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!isAppStoreProduct(product)) {
      skipped.push(id);
      continue;
    }
    const price = decimalPrice(product.price);
    if (price === undefined) unpriced.push(id);
    const displayPrice = price ?? "0.00";
    const name = displayNameOf(product, id);
    const common = {
      displayPrice,
      familyShareable: false,
      internalID: internalId("product", id),
      localizations: [{ description: "", displayName: name, locale: LOCALE }],
      productID: id,
      referenceName: name,
    };
    const type = productTypeOf(product);
    const period = recurringPeriodOf(product);
    if (type === "RecurringSubscription" && period) {
      subscriptions.push({
        adHocOffers: [],
        billingPlans: billingPlansOf(product, id, displayPrice),
        codeOffers: [],
        ...common,
        groupNumber: 1,
        introductoryOffers: introductoryOffersOf(product, id, period),
        recurringSubscriptionPeriod: period,
        subscriptionGroupID: groupId,
        type,
        winbackOffers: [],
      });
    } else if (type === "NonRenewingSubscription") {
      nonRenewing.push({ ...common, type });
    } else {
      oneTime.push({ ...common, type: type === "Consumable" ? "Consumable" : "NonConsumable" });
    }
  }

  const file = {
    appPolicies: { eula: "", policies: [{ locale: LOCALE, policyText: "", policyURL: "" }] },
    identifier: internalId("config", groupName),
    nonRenewingSubscriptions: nonRenewing,
    products: oneTime,
    settings: {
      _askToBuyEnabled: false,
      _billingGracePeriodEnabled: false,
      _billingIssuesEnabled: false,
      _compatibilityTimeRate: { "3": 6 },
      _disableDialogs: false,
      _failTransactionsEnabled: false,
      _locale: LOCALE,
      _renewalBillingIssuesEnabled: false,
      _storefront: "USA",
      _storeKitErrors: STORE_KIT_ERRORS.map((name) => ({ enabled: false, name })),
      _timeRate: 0,
    },
    subscriptionGroups: subscriptions.length ? [{ id: groupId, localizations: [], name: groupName, subscriptions }] : [],
    version: STOREKIT_VERSION,
  };
  return {
    file,
    counts: { total: oneTime.length + nonRenewing.length + subscriptions.length, subscriptions: subscriptions.length },
    unpriced,
    skipped,
  };
}

function identifierOf(product: Row): string {
  return String(product.identifier ?? product.product_identifier ?? product.name ?? "");
}

function displayNameOf(product: Row, id: string): string {
  return typeof product.name === "string" && product.name.trim() ? product.name : id;
}

/** An App Store product, or one whose row doesn't say which store it's in. */
function isAppStoreProduct(product: Row): boolean {
  if (typeof product.store === "string") return product.store === "app_store";
  if (typeof product.platform === "string") return product.platform === "ios";
  return true;
}

/** App Store Connect's type when the API attached it, else Superwall's: a billing period means auto-renewable. */
function productTypeOf(product: Row): ProductType {
  const info = isRecord(product.app_store_info) ? product.app_store_info : undefined;
  const ascType = typeof info?.in_app_purchase_type === "string" ? info.in_app_purchase_type.toUpperCase() : "";
  if (ascType.includes("NON_RENEWING")) return "NonRenewingSubscription";
  if (ascType.includes("RENEWABLE")) return "RecurringSubscription";
  if (ascType === "CONSUMABLE") return "Consumable";
  if (ascType === "NON_CONSUMABLE") return "NonConsumable";
  return isRecord(product.subscription) ? "RecurringSubscription" : "NonConsumable";
}

const PERIOD_LETTER: Record<PeriodUnit, string> = { day: "D", week: "W", month: "M", year: "Y" };

function recurringPeriodOf(product: Row): string | undefined {
  const subscription = isRecord(product.subscription) ? product.subscription : undefined;
  const unit = subscription?.period;
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") return undefined;
  const count = positiveInt(subscription?.period_count) ?? 1;
  if (unit === "day" && count % 7 === 0) return `P${count / 7}W`;
  if (unit === "month" && count % 12 === 0) return `P${count / 12}Y`;
  return `P${count}${PERIOD_LETTER[unit]}`;
}

/** Trial days to the offer durations App Store Connect has (3 days to a year). */
function daysToPeriod(days: number): string {
  if (days >= 365 && days <= 366) return "P1Y";
  for (const months of [6, 3, 2, 1]) {
    if (Math.abs(days - months * 30.4) <= months) return `P${months}M`;
  }
  if (days % 7 === 0) return `P${days / 7}W`;
  return `P${days}D`;
}

const UNIT_DAYS: Record<string, number> = { D: 1, W: 7, M: 30.4, Y: 365 };

function periodDays(period: string): number {
  const match = /^P(\d+)([DWMY])$/.exec(period);
  return match ? Number(match[1]) * (UNIT_DAYS[match[2] ?? "D"] ?? 1) : 0;
}

/**
 * Superwall keeps a subscription's introductory offer as trial days plus a trial price: a free
 * trial when that price is zero or missing, else a first period paid up front. An explicit
 * `subscription.introductory_offer` names its mode itself.
 */
function introductoryOffersOf(product: Row, id: string, period: string): Record<string, unknown>[] {
  const subscription = isRecord(product.subscription) ? product.subscription : {};
  const offer = isRecord(subscription.introductory_offer) ? subscription.introductory_offer : undefined;
  const days = positiveInt(offer?.duration_days) ?? positiveInt(subscription.trial_period_days);
  if (!days) return [];
  const trialPrice = decimalPrice(product.trial_price);
  let mode: PaymentMode = trialPrice !== undefined && Number(trialPrice) > 0 ? "payUpFront" : "free";
  if (offer?.type === "free_trial") mode = "free";
  else if (offer?.type === "pay_up_front") mode = "payUpFront";
  else if (offer?.type === "pay_as_you_go") mode = "payAsYouGo";

  let subscriptionPeriod = daysToPeriod(days);
  let numberOfPeriods = 1;
  if (mode === "payAsYouGo") {
    const each = periodDays(period);
    subscriptionPeriod = period;
    numberOfPeriods = each > 0 ? Math.max(1, Math.round(days / each)) : 1;
  }
  return [
    {
      billingPlanType: "BILLED_UPFRONT",
      ...(mode === "free" ? {} : { displayPrice: trialPrice ?? "0.00" }),
      internalID: internalId("intro", id),
      numberOfPeriods,
      paymentMode: mode,
      subscriptionPeriod,
    },
  ];
}

/** Billed up front always; an annual plan with a monthly price in Superwall also gets Apple's monthly plan. */
function billingPlansOf(product: Row, id: string, displayPrice: string): Record<string, unknown>[] {
  const plans: Record<string, unknown>[] = [
    {
      billingPlanType: "BILLED_UPFRONT",
      commitmentDisplayPrice: displayPrice,
      displayPrice,
      internalID: internalId("plan-upfront", id),
      isEnabled: true,
    },
  ];
  const monthly = decimalPrice(product.monthly_billing_plan_price);
  if (monthly !== undefined) {
    const digits = monthly.split(".")[1]?.length ?? 0;
    plans.push({
      billingPlanType: "MONTHLY",
      commitmentDisplayPrice: (Number(monthly) * 12).toFixed(digits),
      displayPrice: monthly,
      internalID: internalId("plan-monthly", id),
      isEnabled: true,
    });
  }
  return plans;
}

/** `{ amount, currency }` in minor units, as the API returns prices, to Xcode's decimal string. */
function decimalPrice(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const amount = Number(value.amount);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const digits = currencyDigits(typeof value.currency === "string" ? value.currency : "USD");
  return (amount / 10 ** digits).toFixed(digits);
}

function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Xcode's ids are 8 hex digits; derived from the product so exporting again doesn't churn the file. */
function internalId(kind: string, key: string): string {
  return createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 8).toUpperCase();
}
