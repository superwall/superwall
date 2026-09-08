import type { HostVariables } from "../state";

export const EXAMPLE_PRODUCT_VARIABLES = {
  currencyCode: "USD",
  currencySymbol: "$",
  dailyPrice: "$0.25",
  languageCode: "en",
  locale: "en_US@currency=USD",
  monthlyPrice: "$7.50",
  period: "year",
  periodAlt: "1 yr",
  periodDays: 365,
  periodly: "yearly",
  periodMonths: 12,
  periodWeeks: 52,
  periodYears: 1,
  localizedPeriod: "year",
  price: "$89.99",
  rawPrice: 89.99,
  trialPeriodDays: 7,
  trialPeriodMonths: 0,
  trialPeriodText: "7-day",
  trialPeriodWeeks: 1,
  trialPeriodYears: 0,
  rawTrialPeriodPrice: 0,
  trialPeriodPrice: "$0.00",
  trialPeriodDailyPrice: "$0.00",
  trialPeriodWeeklyPrice: "$0.00",
  trialPeriodMonthlyPrice: "$0.00",
  trialPeriodYearlyPrice: "$0.00",
  weeklyPrice: "$1.73",
  yearlyPrice: "$89.99",
} satisfies HostVariables;

export const withoutTrial = (variables: HostVariables): HostVariables =>
  Object.fromEntries(
    Object.entries(variables).filter(([key]) => !key.toLowerCase().includes("trial")),
  );

export const EXAMPLE_PRODUCT_VARIABLES_NO_TRIAL: HostVariables =
  withoutTrial(EXAMPLE_PRODUCT_VARIABLES);
