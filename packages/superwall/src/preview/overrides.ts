import type {
  SuperwallDeviceVariables,
  SuperwallPlacementParams,
  SuperwallUserVariables,
} from "@superwall/runtime";

export type PreviewOverrides = {
  theme?: "light" | "dark";
  locale?: string;
  device?: SuperwallDeviceVariables;
  user?: SuperwallUserVariables;
  params?: SuperwallPlacementParams;
  products?: Record<string, Record<string, unknown>>;
  trialEligible?: boolean;
};

const readRecord = (params: URLSearchParams, key: string): Record<string, unknown> | undefined => {
  const raw = params.get(key);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return undefined;
};

export const readPreviewOverrides = (search: string): PreviewOverrides => {
  const params = new URLSearchParams(search);
  const overrides: PreviewOverrides = {};

  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") overrides.theme = theme;

  const locale = params.get("locale");
  if (locale) overrides.locale = locale;

  const device = readRecord(params, "sw_device");
  if (device) overrides.device = device as SuperwallDeviceVariables;

  const user = readRecord(params, "sw_user");
  if (user) overrides.user = user;

  const placement = readRecord(params, "sw_params");
  if (placement) overrides.params = placement;

  const trial = params.get("sw_trial");
  if (trial === "1" || trial === "0") overrides.trialEligible = trial === "1";

  const products = readRecord(params, "sw_products");
  if (products) {
    overrides.products = Object.fromEntries(
      Object.entries(products).filter(
        (entry): entry is [string, Record<string, unknown>] =>
          typeof entry[1] === "object" && entry[1] !== null && !Array.isArray(entry[1]),
      ),
    );
  }

  return overrides;
};

let patchedMatchMedia: typeof window.matchMedia | undefined;
let hostMatchMedia: typeof window.matchMedia | undefined;

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
