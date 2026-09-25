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
  Object.assign(variables, periodCounts(period, count) ?? {});

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
