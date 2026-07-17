import * as React from "react";
import type { SuperwallTranslateValues } from "@superwall/runtime";
import { useSuperwallSession } from "../context";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseTranslationResult = {
  /**
   * Resolves a message key ("paywall.title") for the active locale,
   * interpolating `{name}` params. Unknown keys return the key itself.
   */
  t: (key: string, values?: SuperwallTranslateValues) => string;
  /** The active locale, auto-detected from the device unless overridden. */
  locale: string;
  /** Overrides the auto-detected locale. Pass `undefined` to reset. */
  setLocale: (locale: string | undefined) => void;
  /** Locales with a message catalog. */
  locales: readonly string[];
};

/**
 * Localization. Locale is auto-detected from the device; messages come from
 * `config.localization.messages`.
 *
 * ```tsx
 * const { t } = useTranslation()
 * <h1>{t("paywall.title", { appName: "Superwall" })}</h1>
 * ```
 */
export const useTranslation = (): UseTranslationResult => {
  const session = useSuperwallSession();
  const snapshot = useSuperwallSnapshot();

  return React.useMemo(
    () => ({
      t: session.t,
      locale: snapshot.locale,
      setLocale: session.setLocale.bind(session),
      locales: Object.keys(snapshot.config?.localization?.messages ?? {}),
    }),
    [session, snapshot.locale, snapshot.config],
  );
};
