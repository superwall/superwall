const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

const THREE_DECIMAL_CURRENCIES = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

export const minorUnitsToAmount = (amountMinorUnits: number, currency: string): number => {
  const normalized = currency.toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return amountMinorUnits;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return amountMinorUnits / 1000;
  return amountMinorUnits / 100;
};

export const formatMinorUnits = (
  amountMinorUnits: number,
  currency: string,
  locale?: string,
): string => {
  const amount = minorUnitsToAmount(amountMinorUnits, currency);
  const isThreeDecimal = THREE_DECIMAL_CURRENCIES.has(currency.toLowerCase());
  try {
    return new Intl.NumberFormat(locale?.replace(/_/g, "-") || "en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      ...(isThreeDecimal
        ? { minimumFractionDigits: 3, maximumFractionDigits: 3 }
        : {
            ...(amount % 1 === 0 ? { minimumFractionDigits: 0 } : {}),
            maximumFractionDigits: 2,
          }),
    }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
};
