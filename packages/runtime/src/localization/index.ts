import type { SuperwallLocalizationConfig, SuperwallMessages } from "../config";

export type SuperwallTranslateValues = Record<string, string | number>;

export type SuperwallTranslator = {
  /**
   * Resolves a message key ("paywall.title") for the active locale,
   * interpolating `{name}` params. Unknown keys return the key itself, so
   * passing literal copy through `t()` is always safe.
   */
  t: (key: string, values?: SuperwallTranslateValues) => string;
  locale: string;
  /** Locales with a message catalog. */
  locales: readonly string[];
};

const lookupMessage = (messages: SuperwallMessages | undefined, key: string) => {
  if (!messages) return undefined;

  let current: SuperwallMessages | string | undefined = messages;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = current[segment];
  }

  return typeof current === "string" ? current : undefined;
};

const interpolate = (template: string, values: SuperwallTranslateValues = {}) =>
  template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );

/**
 * Language candidates for the shared period-translation table
 * ("de-DE" / "de_DE" → ["de_DE", "de"]), matching its underscore keys.
 */
export const languageCandidates = (locale: string | undefined): string[] => {
  if (!locale) return ["en"];

  const normalized = locale.replace(/-/g, "_");
  const [language] = normalized.split("_");
  const candidates = [normalized];

  if (language && language !== normalized) {
    candidates.push(language.toLowerCase());
  }

  return candidates;
};

/** Normalizes "en_US" / "en-us" → "en-US"; returns [exact, language] candidates. */
const localeCandidates = (locale: string): string[] => {
  const normalized = locale.replace(/_/g, "-");
  const [language, region] = normalized.split("-");
  const candidates: string[] = [];

  if (language && region) {
    candidates.push(`${language.toLowerCase()}-${region.toUpperCase()}`);
  }
  if (language) {
    candidates.push(language.toLowerCase());
  }

  return candidates;
};

/**
 * Picks the best available locale: exact match ("pt-BR"), then language
 * ("pt"), then the default locale.
 */
export const resolveLocale = (
  requested: string | undefined,
  localization: SuperwallLocalizationConfig | undefined,
): string => {
  const defaultLocale = localization?.defaultLocale ?? "en";
  const messages = localization?.messages;
  if (!requested || !messages) return defaultLocale;

  const available = Object.keys(messages);
  const availableLower = new Map(available.map((locale) => [locale.toLowerCase(), locale]));

  for (const candidate of localeCandidates(requested)) {
    const match = availableLower.get(candidate.toLowerCase());
    if (match) return match;
  }

  return defaultLocale;
};

export const createTranslator = (
  localization: SuperwallLocalizationConfig | undefined,
  locale: string,
): SuperwallTranslator => {
  const messages = localization?.messages;
  const defaultLocale = localization?.defaultLocale ?? "en";

  const t = (key: string, values?: SuperwallTranslateValues) => {
    const resolved =
      lookupMessage(messages?.[locale], key) ?? lookupMessage(messages?.[defaultLocale], key);

    return interpolate(resolved ?? key, values);
  };

  return {
    t,
    locale,
    locales: messages ? Object.keys(messages) : [defaultLocale],
  };
};
