import type { SuperwallConfig } from "@superwall/runtime";

/**
 * App-level configuration — `superwall/config.ts` at the project root.
 * `defaults` merge under every paywall's own config, so shared settings
 * (presentation, feature gating, purchase timeout, …) live in one place.
 */
export type SuperwallAppConfig = {
  defaults?: Partial<SuperwallConfig>;
};

/** Declares project-wide defaults every paywall and funnel inherits. */
export const defineConfig = (config: SuperwallAppConfig): SuperwallAppConfig => config;

/**
 * Merges a paywall config over app-level defaults. Top-level fields from the
 * paywall win; `presentation`, `notifications`, and `localization` merge one
 * level deep so a paywall can override a single field without restating the
 * group. Message catalogs merge per locale.
 */
export const mergeSurfaceConfig = (
  defaults: Partial<SuperwallConfig> | undefined,
  config: Partial<SuperwallConfig> | undefined,
): SuperwallConfig => {
  const base = defaults ?? {};
  const surface = config ?? {};
  const localization = surface.localization ?? base.localization;

  return {
    ...base,
    ...surface,
    presentation:
      base.presentation || surface.presentation
        ? { ...base.presentation, ...surface.presentation }
        : undefined,
    notifications:
      base.notifications || surface.notifications
        ? { ...base.notifications, ...surface.notifications }
        : undefined,
    localization: localization
      ? {
          ...localization,
          messages: {
            ...base.localization?.messages,
            ...surface.localization?.messages,
          },
        }
      : undefined,
  };
};
