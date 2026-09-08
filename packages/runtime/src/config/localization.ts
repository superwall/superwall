/**
 * Nested message catalog for one locale. Values interpolate `{name}` params:
 * `{ paywall: { title: "Unlock {appName}" } }` → `t("paywall.title", { appName })`.
 */
export type SuperwallMessages = { [key: string]: string | SuperwallMessages };

export type SuperwallLocalizationConfig<TLocale extends string = string> = {
  /** Locale used when the device locale has no catalog. */
  defaultLocale: TLocale;
  /** Message catalogs by locale (e.g. `{ en, de, "pt-BR": ptBR }`). */
  messages?: Record<TLocale, SuperwallMessages> & Record<string, SuperwallMessages>;
};
