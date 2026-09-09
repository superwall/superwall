import { ROUTE_ASSETS_ID } from "../document";

const ASSET_KINDS = ["image", "video", "audio", "font"] as const;

export type RouteAsset = { url: string; as: (typeof ASSET_KINDS)[number] };

export const readRouteAsset = (value: unknown): RouteAsset | undefined => {
  if (typeof value !== "object" || value === null || !("url" in value) || !("as" in value)) {
    return undefined;
  }
  const kind = ASSET_KINDS.find((candidate) => candidate === value.as);
  return typeof value.url === "string" && kind ? { url: value.url, as: kind } : undefined;
};

export const readRouteAssets = (): Record<string, RouteAsset[]> => {
  const source = document.getElementById(ROUTE_ASSETS_ID)?.textContent;
  if (!source) return {};
  try {
    const parsed: unknown = JSON.parse(source);
    if (typeof parsed !== "object" || parsed === null) return {};
    const map: Record<string, RouteAsset[]> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        map[name] = value.map(readRouteAsset).filter((asset) => asset !== undefined);
      }
    }
    return map;
  } catch {
    return {};
  }
};

export const warmAssets = (assets: readonly RouteAsset[], warmed: Set<string>): void => {
  for (const asset of assets) {
    if (warmed.has(asset.url)) continue;
    warmed.add(asset.url);
    if (asset.as === "image") {
      new Image().src = asset.url;
      continue;
    }
    const link = document.createElement("link");
    link.setAttribute("rel", "preload");
    link.setAttribute("as", asset.as);
    link.setAttribute("href", asset.url);
    if (asset.as === "font") link.setAttribute("crossorigin", "anonymous");
    document.head.appendChild(link);
  }
};

export const whenIdle = (run: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run);
    return () => window.cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, 200);
  return () => clearTimeout(timer);
};
