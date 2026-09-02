import type { PreviewOverrides, PreviewUrlBuilder, StudioSurface } from "./types";

const overrideParams = (overrides: PreviewOverrides): URLSearchParams => {
  const params = new URLSearchParams();
  if (overrides.theme) params.set("theme", overrides.theme);
  if (overrides.locale) params.set("locale", overrides.locale);
  for (const [key, group] of [
    ["sw_device", overrides.device],
    ["sw_user", overrides.user],
    ["sw_params", overrides.params],
    ["sw_products", overrides.products],
  ] as const) {
    if (group && Object.keys(group).length > 0) params.set(key, JSON.stringify(group));
  }
  if (overrides.trialEligible !== undefined) {
    params.set("sw_trial", overrides.trialEligible ? "1" : "0");
  }
  return params;
};

export const surfacePath = (surface: StudioSurface): string =>
  `${surface.project ? `/${surface.project}` : ""}/${surface.kind}/${surface.id}`;

export const devicePreviewPath = (surface: StudioSurface): string =>
  `/preview${surfacePath(surface)}?sw_preview=1`;

export const buildPreviewPath: PreviewUrlBuilder = (
  surface: StudioSurface,
  overrides: PreviewOverrides,
): string => {
  const query = overrideParams(overrides).toString();
  return `/preview${surfacePath(surface)}${query ? `?${query}` : ""}`;
};

export const withOverrides = (url: string, overrides: PreviewOverrides): string => {
  const query = overrideParams(overrides).toString();
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
};

export const withPreviewOptIn = (url: string): string => {
  if (/[?&]sw_preview=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sw_preview=1`;
};

export const snapshotPreviewUrl =
  (urlOf: (surface: StudioSurface) => string): PreviewUrlBuilder =>
  (surface, overrides) =>
    withOverrides(withPreviewOptIn(urlOf(surface)), overrides);
