import type { PreviewUrlBuilder, StudioSurface } from "./types";

export const surfacePath = (surface: StudioSurface): string =>
  `${surface.project ? `/${surface.project}` : ""}/${surface.kind}/${surface.id}`;

export const hostedUrl = (url: string): string => {
  if (/[?&]transport=editor(?:&|$)/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}transport=editor`;
};

export const buildPreviewPath: PreviewUrlBuilder = (surface) =>
  hostedUrl(`/preview${surfacePath(surface)}`);

export const snapshotPreviewUrl =
  (urlOf: (surface: StudioSurface) => string): PreviewUrlBuilder =>
  (surface) =>
    hostedUrl(urlOf(surface));
