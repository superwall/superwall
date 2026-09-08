import type { SuperwallLocalizationConfig } from "../config/localization";

const localeCandidates = (locale: string): string[] => {
  const [language, region] = locale.replace(/_/g, "-").split("-");
  const candidates: string[] = [];
  if (language && region) candidates.push(`${language.toLowerCase()}-${region.toUpperCase()}`);
  if (language) candidates.push(language.toLowerCase());
  return candidates;
};

export const resolveLocale = (
  requested: string | undefined,
  localization: SuperwallLocalizationConfig | undefined,
): string => {
  const defaultLocale = localization?.defaultLocale ?? "en";
  const messages = localization?.messages;
  if (!requested || !messages) return defaultLocale;

  const available = new Map(Object.keys(messages).map((locale) => [locale.toLowerCase(), locale]));
  for (const candidate of localeCandidates(requested)) {
    const match = available.get(candidate.toLowerCase());
    if (match) return match;
  }
  return defaultLocale;
};
