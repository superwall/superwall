import type { SuperwallDeviceVariables } from "@superwall/runtime";

export type PreviewOverrides = {
  theme?: "light" | "dark";
  locale?: string;
  device?: SuperwallDeviceVariables;
};

export const readPreviewOverrides = (search: string): PreviewOverrides => {
  const params = new URLSearchParams(search);
  const overrides: PreviewOverrides = {};

  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") overrides.theme = theme;

  const locale = params.get("locale");
  if (locale) overrides.locale = locale;

  const rawDevice = params.get("sw_device");
  if (rawDevice) {
    try {
      const parsed: unknown = JSON.parse(rawDevice);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        overrides.device = parsed as SuperwallDeviceVariables;
      }
    } catch {}
  }

  return overrides;
};

let patchedMatchMedia: typeof window.matchMedia | undefined;
let hostMatchMedia: typeof window.matchMedia | undefined;

/**
 * Simulates the device color scheme. Re-callable: the studio re-applies it
 * live when the theme control flips, so the patched `matchMedia` always
 * answers for the current simulation (and `undefined` restores the host's).
 */
export const applyThemeOverride = (theme: "light" | "dark" | undefined): void => {
  if (typeof document !== "undefined") {
    document.documentElement.style.colorScheme = theme ?? "";
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

  if (window.matchMedia !== patchedMatchMedia) {
    hostMatchMedia = window.matchMedia.bind(window);
  }
  if (!theme) {
    if (patchedMatchMedia && hostMatchMedia) window.matchMedia = hostMatchMedia;
    patchedMatchMedia = undefined;
    return;
  }

  const original = hostMatchMedia ?? window.matchMedia.bind(window);
  const patched = (query: string): MediaQueryList => {
    if (!query.includes("prefers-color-scheme")) return original(query);
    const matches = query.includes(theme);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  };
  patchedMatchMedia = patched;
  window.matchMedia = patched;
};
