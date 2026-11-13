import { writeFileSync } from "node:fs";
import type { CommandContext } from "@/program/command";
import { pickScope } from "@/core/account/scope";
import type { SuperwallApi } from "@/core/api/client";
import { listResource, type Row } from "@/core/api/resources";
import { field, isRecord } from "@/core/json";
import { formatJson } from "@/program/output";
import { apiCall } from "@/ui/spinner";
import { textOf } from "./input";

type StoreKitSkipReason = "no_identifier" | "other_store" | "no_price";

export interface StoreKitSkipped {
  id: string;
  identifier: string;
  reason: StoreKitSkipReason;
}

interface StoreKitExport {
  file: object;
  written: number;
  skipped: StoreKitSkipped[];
}

interface StoreKitOptions {
  teamId?: string;
}

const GROUP_ID = "20000000";

const PERIOD_UNITS: Record<string, string> = { day: "D", week: "W", month: "M", year: "Y" };

const TRIAL_PERIODS: Record<number, string> = {
  7: "P1W",
  14: "P2W",
  30: "P1M",
  60: "P2M",
  90: "P3M",
  180: "P6M",
  365: "P1Y",
};

interface Mapped {
  identifier: string;
  internalID: string;
  amount: number;
  base: {
    displayPrice: string;
    familyShareable: boolean;
    internalID: string;
    localizations: Array<{ description: string; displayName: string; locale: string }>;
    productID: string;
    referenceName: string;
  };
  period?: string;
  introductoryOffer: object | null;
}

export async function writeStoreKit(context: CommandContext, api: SuperwallApi, out: unknown): Promise<void> {
  const scope = await pickScope(context, api, false);
  const products = await apiCall(context, "Loading products", () =>
    listResource(api, "products", scope),
  );
  const outFile = textOf(out) ?? "Superwall.storekit";
  const { file, written, skipped } = generateStoreKit(products);
  writeFileSync(outFile, `${formatJson(file)}\n`);
  if (context.json) {
    return context.output.data({ path: outFile, products: written, skipped });
  }
  context.ui.success(`Wrote \`${outFile}\` with ${written} product${written === 1 ? "" : "s"}`);
  for (const line of describeSkipped(skipped)) context.ui.warn(line);
}

const SKIP_REASONS: Array<[StoreKitSkipReason, string]> = [
  ["other_store", "not sold on the App Store"],
  ["no_price", "with no price in Superwall"],
  ["no_identifier", "with no store identifier"],
];

export function describeSkipped(skipped: StoreKitSkipped[]): string[] {
  const lines: string[] = [];
  for (const [reason, label] of SKIP_REASONS) {
    const names = skipped.filter((product) => product.reason === reason).map((product) => product.identifier);
    if (names.length === 0) continue;
    const listed = names.filter(Boolean).map((name) => `\`${name}\``).join(", ");
    lines.push(`Left out ${names.length} product${names.length === 1 ? "" : "s"} ${label}${listed ? `: ${listed}` : ""}`);
    if (reason !== "no_price") continue;
    for (const product of skipped.filter((entry) => entry.reason === reason)) {
      lines.push(
        `Price \`${product.identifier}\` in minor units (399 is 3.99) with ` +
          `\`superwall products update ${product.id} --price '{"amount":<amount>,"currency":"USD"}'\`, then export again`,
      );
    }
  }
  return lines;
}

export function generateStoreKit(products: Row[], options: StoreKitOptions = {}): StoreKitExport {
  const skipped: StoreKitSkipped[] = [];
  const mapped: Mapped[] = [];

  for (const product of products) {
    const identifier = textOf(product.identifier) ?? textOf(product.product_identifier) ?? textOf(product.name);
    if (!identifier) {
      skipped.push({ id: String(product.id ?? ""), identifier: String(product.id ?? ""), reason: "no_identifier" });
      continue;
    }
    if (!isAppStore(product)) {
      skipped.push({ id: String(product.id ?? ""), identifier, reason: "other_store" });
      continue;
    }
    const amount = amountOf(product.price);
    if (amount === undefined) {
      skipped.push({ id: String(product.id ?? ""), identifier, reason: "no_price" });
      continue;
    }
    const internalID = String(1000 + mapped.length);
    const name = textOf(product.name) ?? identifier;
    const subscription = isRecord(product.subscription) ? product.subscription : undefined;
    const period = subscription ? periodOf(subscription) : undefined;
    mapped.push({
      identifier,
      internalID,
      amount,
      base: {
        displayPrice: displayPrice(amount, currencyOf(product.price)),
        familyShareable: false,
        internalID,
        localizations: [{ description: name, displayName: name, locale: "en_US" }],
        productID: identifier,
        referenceName: name,
      },
      period,
      introductoryOffer: subscription && period ? introductoryOffer(product, subscription, internalID) : null,
    });
  }

  const subscriptions = mapped.filter((product) => product.period !== undefined);
  const ranked = [...subscriptions].sort((a, b) => b.amount - a.amount);

  const file = {
    identifier: "SUPERWALL",
    nonRenewingSubscriptions: [],
    products: mapped
      .filter((product) => product.period === undefined)
      .map((product) => ({ ...product.base, type: "NonConsumable" })),
    settings: options.teamId ? { _developerTeamID: options.teamId } : {},
    subscriptionGroups:
      subscriptions.length === 0
        ? []
        : [
            {
              id: GROUP_ID,
              localizations: [],
              name: "Subscriptions",
              subscriptions: subscriptions.map((product) => ({
                adHocOffers: [],
                codeOffers: [],
                ...product.base,
                groupNumber: ranked.indexOf(product) + 1,
                introductoryOffer: product.introductoryOffer,
                recurringSubscriptionPeriod: product.period,
                subscriptionGroupID: GROUP_ID,
                type: "RecurringSubscription",
              })),
            },
          ],
    version: { major: 3, minor: 0 },
  };

  return { file, written: mapped.length, skipped };
}

function isAppStore(product: Row): boolean {
  const store = textOf(product.store);
  if (store) return store === "app_store";
  const platform = textOf(product.platform);
  return platform === undefined || platform === "ios";
}

function amountOf(price: unknown): number | undefined {
  const amount = field(price, "amount");
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function currencyOf(price: unknown): string {
  return textOf(field(price, "currency")) ?? "USD";
}

function displayPrice(amount: number, currency: string): string {
  const digits = minorDigits(currency);
  return (amount / 10 ** digits).toFixed(digits);
}

function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : undefined;
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

function periodOf(subscription: Record<string, unknown>): string | undefined {
  const unit = PERIOD_UNITS[String(subscription.period)];
  if (!unit) return undefined;
  return `P${positiveInteger(subscription.period_count) ?? 1}${unit}`;
}

function introductoryOffer(product: Row, subscription: Record<string, unknown>, internalID: string): object | null {
  const days = positiveInteger(subscription.trial_period_days);
  if (days === undefined) return null;
  const offerID = Number(internalID).toString(16).toUpperCase().padStart(8, "0");
  const subscriptionPeriod = TRIAL_PERIODS[days] ?? `P${days}D`;
  const trialAmount = amountOf(product.trial_price) ?? 0;
  if (trialAmount === 0) {
    return { internalID: offerID, numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod };
  }
  return {
    displayPrice: displayPrice(trialAmount, textOf(field(product.trial_price, "currency")) ?? currencyOf(product.price)),
    internalID: offerID,
    numberOfPeriods: 1,
    paymentMode: "payUpFront",
    subscriptionPeriod,
  };
}
