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
    } catch {
      // Untrusted URL input — ignore anything malformed.
    }
  }

  return overrides;
};

export const applyThemeOverride = (theme: "light" | "dark" | undefined): void => {
  if (!theme) return;

  document.documentElement.style.colorScheme = theme;

  if (typeof window.matchMedia !== "function") return;

  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string): MediaQueryList => {
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
};
