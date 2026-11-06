export interface DashboardPrice {
  amount?: number;
  currency?: string;
}

export interface DashboardProduct {
  identifier?: string;
  price?: DashboardPrice | null;
  trial_price?: DashboardPrice | null;
  monthly_billing_plan_price?: DashboardPrice | null;
  subscription?: {
    period?: string;
    period_count?: number;
    trial_period_days?: number | null;
  } | null;
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

const PER_YEAR: Record<string, number> = { day: 365, week: 52, month: 12, year: 1 };

const symbolFor = (currency: string): string => SYMBOLS[currency.toUpperCase()] ?? "";

const money = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${symbolFor(currency)}${amount.toFixed(2)}`;
  }
};

const fractionDigits = (currency: string): number => {
  try {
    const parts = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0);
    return parts.find((part) => part.type === "fraction")?.value.length ?? 0;
  } catch {
    return 2;
  }
};

const majorUnits = (amount: number, currency: string): number =>
  amount / 10 ** fractionDigits(currency);

const trialVariables = (
  product: DashboardProduct,
  currency: string,
  days: number,
): Record<string, unknown> | undefined => {
  const trialPrice = product.trial_price;
  const amount = trialPrice?.amount ?? 0;
  if (amount !== 0 && trialPrice?.currency?.toUpperCase() !== currency) return undefined;

  const raw = majorUnits(amount, currency);
  const yearly = (raw * 365) / days;
  return {
    trialPeriodDays: days,
    trialPeriodWeeks: Math.floor(days / 7),
    trialPeriodMonths: Math.floor(days / 30),
    trialPeriodYears: Math.floor(days / 365),
    trialPeriodText: `${days}-day`,
    rawTrialPeriodPrice: raw,
    trialPeriodPrice: money(raw, currency),
    trialPeriodDailyPrice: money(raw / days, currency),
    trialPeriodWeeklyPrice: money(yearly / 52, currency),
    trialPeriodMonthlyPrice: money(yearly / 12, currency),
    trialPeriodYearlyPrice: money(yearly, currency),
  };
};

const PERIODLY: Record<string, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

const PERIOD_UNITS: Record<string, { days: number; weeks: number; months: number; years: number }> =
  {
    day: { days: 1, weeks: 1 / 7, months: 1 / 30, years: 1 / 365 },
    week: { days: 7, weeks: 1, months: 1 / 4, years: 1 / 52 },
    month: { days: 30, weeks: 4, months: 1, years: 1 / 12 },
    year: { days: 365, weeks: 52, months: 12, years: 1 },
  };

const periodCounts = (period: string, count: number): Record<string, number> | undefined => {
  const units = PERIOD_UNITS[period];
  if (!units) return undefined;
  return {
    periodDays: units.days * count,
    periodWeeks: Math.round(units.weeks * count),
    periodMonths: Math.floor(units.months * count),
    periodYears: Math.floor(units.years * count),
  };
};

const periodLabels = (period: string, count: number): { period: string; periodly: string } => {
  if (count === 1 || !PERIOD_UNITS[period]) {
    return { period, periodly: PERIODLY[period] ?? `${period}ly` };
  }
  if (period === "month" && count === 3) return { period: "quarter", periodly: "quarterly" };
  const label = `${count} ${period}s`;
  return { period: label, periodly: `every ${label}` };
};

export const productVariables = (product: DashboardProduct): Record<string, unknown> => {
  const variables: Record<string, unknown> = {};
  if (product.identifier) variables.identifier = product.identifier;

  const price = product.price;
  if (!price || typeof price.amount !== "number" || !price.currency) return variables;

  const currency = price.currency.toUpperCase();
  const value = majorUnits(price.amount, currency);
  variables.price = money(value, currency);
  variables.rawPrice = value;
  variables.currencyCode = currency;
  variables.currencySymbol = symbolFor(currency);

  const period = product.subscription?.period;
  if (!period) return variables;

  const count = product.subscription?.period_count ?? 1;
  Object.assign(variables, periodLabels(period, count));
  Object.assign(variables, periodCounts(period, count) ?? {});

  const perYear = (PER_YEAR[period] ?? 1) / count;
  variables.yearlyPrice = money(value * perYear, currency);
  variables.monthlyPrice = money((value * perYear) / 12, currency);
  variables.weeklyPrice = money((value * perYear) / 52, currency);
  variables.dailyPrice = money((value * perYear) / 365, currency);

  const trialDays = product.subscription?.trial_period_days;
  if (typeof trialDays === "number" && trialDays > 0) {
    Object.assign(variables, trialVariables(product, currency, trialDays) ?? {});
  }

  return variables;
};
