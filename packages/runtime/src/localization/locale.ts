import type { SuperwallLocalizationConfig } from "../config/localization";

const legacyLanguages: Record<string, string> = { in: "id", iw: "he", ji: "yi" };

const languageAliases: Record<string, string> = { nb: "no", no: "nb" };

export const canonicalLanguage = (language: string): string => {
  const lower = language.toLowerCase();
  return legacyLanguages[lower] ?? lower;
};

const canonicalLocale = (locale: string): string => {
  const [language = "", ...rest] = locale.replace(/_/g, "-").split("-");
  return [canonicalLanguage(language), ...rest].join("-").toLowerCase();
};

const localeCandidates = (locale: string): string[] => {
  const [rawLanguage, region] = locale.replace(/_/g, "-").split("-");
  if (!rawLanguage) return [];
  const language = canonicalLanguage(rawLanguage);
  const candidates: string[] = [];
  if (region) candidates.push(`${language}-${region.toLowerCase()}`);
  candidates.push(language);
  const alias = languageAliases[language];
  if (alias) candidates.push(alias);
  return candidates;
};

export const resolveLocale = (
  requested: string | undefined,
  localization: SuperwallLocalizationConfig | undefined,
): string => {
  const defaultLocale = localization?.defaultLocale ?? "en";
  const messages = localization?.messages;
  if (!requested || !messages) return defaultLocale;

  const available = new Map<string, string>();
  for (const key of Object.keys(messages)) {
    const canonical = canonicalLocale(key);
    if (!available.has(canonical) || canonical === key.toLowerCase().replace(/_/g, "-")) {
      available.set(canonical, key);
    }
  }
  for (const candidate of localeCandidates(requested)) {
    const match = available.get(candidate);
    if (match) return match;
  }
  return defaultLocale;
};
