import type { SuperwallApi } from "@/core/api/client";
import { listProjects } from "@/core/api/resources";

interface Price {
  amount?: number;
  currency?: string;
}

interface DashboardProduct {
  identifier?: string;
  price?: Price | null;
  trial_price?: Price | null;
  monthly_billing_plan_price?: Price | null;
  subscription?: { period?: string; period_count?: number; trial_period_days?: number } | null;
}

const SYMBOLS: Record<string, string> = {
  USD: "$",
  CAD: "$",
  AUD: "$",
  NZD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  INR: "₹",
  KRW: "₩",
  BRL: "R$",
  MXN: "$",
  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  TRY: "₺",
  RUB: "₽",
  ZAR: "R",
};

const MINOR = 100;

const PER_YEAR: Record<string, number> = { day: 365, week: 52, month: 12, year: 1 };

const symbolFor = (currency: string): string => SYMBOLS[currency.toUpperCase()] ?? "";

const money = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${symbolFor(currency)}${amount.toFixed(2)}`;
  }
};

const PERIODLY: Record<string, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

export const productVariables = (product: DashboardProduct): Record<string, unknown> => {
  const variables: Record<string, unknown> = {};
  if (product.identifier) variables.identifier = product.identifier;

  const price = product.price;
  if (!price || typeof price.amount !== "number" || !price.currency) return variables;

  const currency = price.currency.toUpperCase();
  const value = price.amount / MINOR;
  variables.price = money(value, currency);
  variables.rawPrice = value;
  variables.currencyCode = currency;
  variables.currencySymbol = symbolFor(currency);

  const period = product.subscription?.period;
  if (!period) return variables;

  const count = product.subscription?.period_count ?? 1;
  variables.period = period;
  variables.periodly = PERIODLY[period] ?? `${period}ly`;
  variables[`period${period.charAt(0).toUpperCase()}${period.slice(1)}s`] = count;

  const perYear = (PER_YEAR[period] ?? 1) / count;
  variables.yearlyPrice = money(value * perYear, currency);
  variables.monthlyPrice = money((value * perYear) / 12, currency);
  variables.weeklyPrice = money((value * perYear) / 52, currency);
  variables.dailyPrice = money((value * perYear) / 365, currency);

  const trialDays = product.subscription?.trial_period_days;
  if (typeof trialDays === "number" && trialDays > 0) {
    variables.trialPeriodDays = trialDays;
    variables.trialPeriodText = `${trialDays}-day`;
  }

  return variables;
};

export async function fetchProducts(
  api: SuperwallApi,
  projectId: string,
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await api.list<DashboardProduct>(
    `/v2/products?project_id=${encodeURIComponent(projectId)}`,
  );
  const catalogue: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    if (row.identifier) catalogue[row.identifier] = productVariables(row);
  }
  return catalogue;
}

export async function projectForApplication(
  api: SuperwallApi,
  applicationId: string,
): Promise<string | undefined> {
  const projects = await listProjects(api).catch(() => []);
  const owner = projects.find((project) =>
    (project.applications ?? []).some((app) => String(app.id) === applicationId),
  );
  return owner ? String(owner.id) : undefined;
}

export class MissingProductError extends Error {}

export function requireProducts(
  catalogue: Record<string, Record<string, unknown>>,
  surfaces: readonly { id: string; products?: Record<string, string> }[],
): void {
  const gaps = surfaces.flatMap((surface) =>
    Object.entries(surface.products ?? {})
      .filter(([, identifier]) => catalogue[identifier] === undefined)
      .map(([reference, identifier]) => `  ${surface.id}: ${reference} → ${identifier}`),
  );
  if (gaps.length === 0) return;

  throw new MissingProductError(
    [
      gaps.length === 1
        ? "This product does not exist on Superwall:"
        : `These ${gaps.length} products do not exist on Superwall:`,
      ...gaps,
      "",
      "Every variable on them would be undefined on device. Add them in the",
      "dashboard, or point the config at products that exist.",
    ].join("\n"),
  );
}
