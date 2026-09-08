import type { SuperwallLocalizationConfig, SuperwallMessages } from "../config/localization";

export type SuperwallTranslateValues = Record<string, string | number>;

export type SuperwallTranslator = {
  t: (key: string, values?: SuperwallTranslateValues) => string;
  locale: string;
  locales: readonly string[];
};

const lookupMessage = (
  messages: SuperwallMessages | undefined,
  key: string,
): string | undefined => {
  let current: SuperwallMessages | string | undefined = messages;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = current[segment];
  }
  return typeof current === "string" ? current : undefined;
};

const interpolate = (template: string, values: SuperwallTranslateValues = {}): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );

export const createTranslator = (
  localization: SuperwallLocalizationConfig | undefined,
  locale: string,
): SuperwallTranslator => {
  const messages = localization?.messages;
  const defaultLocale = localization?.defaultLocale ?? "en";
  return {
    t: (key, values) =>
      interpolate(
        lookupMessage(messages?.[locale], key) ??
          lookupMessage(messages?.[defaultLocale], key) ??
          key,
        values,
      ),
    locale,
    locales: messages ? Object.keys(messages) : [defaultLocale],
  };
};
