import type { PreviewUrlBuilder, StudioSurface } from "./surfaces";

export const surfacePath = (surface: StudioSurface): string =>
  `${surface.project ? `/${surface.project}` : ""}/${surface.kind}/${surface.id}`;

export const hostedUrl = (url: string): string => {
  if (/[?&]transport=editor(?:&|$)/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}transport=editor`;
};

export const originalUrl = (surface: StudioSurface): string =>
  `/__studio/original${surfacePath(surface)}`;

export const buildPreviewPath: PreviewUrlBuilder = (surface) =>
  hostedUrl(`/preview${surfacePath(surface)}`);

export const snapshotPreviewUrl =
  (urlOf: (surface: StudioSurface) => string): PreviewUrlBuilder =>
  (surface) =>
    hostedUrl(urlOf(surface));
