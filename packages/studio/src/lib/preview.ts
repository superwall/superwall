import type { PreviewOverrides, PreviewUrlBuilder, StudioSurface } from "./types";

const overrideParams = (overrides: PreviewOverrides): URLSearchParams => {
  const params = new URLSearchParams();
  if (overrides.theme) params.set("theme", overrides.theme);
  if (overrides.locale) params.set("locale", overrides.locale);
  if (overrides.variables && Object.keys(overrides.variables).length > 0) {
    params.set("sw_vars", JSON.stringify(overrides.variables));
  }
  if (overrides.device && Object.keys(overrides.device).length > 0) {
    params.set("sw_device", JSON.stringify(overrides.device));
  }
  return params;
};

export const buildPreviewPath: PreviewUrlBuilder = (
  surface: StudioSurface,
  overrides: PreviewOverrides,
): string => {
  const query = overrideParams(overrides).toString();
  return `/preview/${surface.kind}/${surface.id}${query ? `?${query}` : ""}`;
};

export const withOverrides = (url: string, overrides: PreviewOverrides): string => {
  const query = overrideParams(overrides).toString();
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
};
