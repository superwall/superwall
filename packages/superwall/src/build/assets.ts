import { createHash } from "node:crypto";
import * as path from "node:path";
import type { Plugin } from "vite";
import { externalSources } from "./externality";
import type { DiscoveredSurface } from "../discover";
import { ROUTE_ASSETS_ID } from "../document";

export type SnapshotAsset = {
  fileName: string;
  sha256: string;
  bytes: number;
  mime: string;
  path: string;
};

export type RouteAsset = {
  url: string;
  as: "image" | "video" | "audio" | "font";
};

export type RouteAssets = Record<string, RouteAsset[]>;

export type CollectedAssets = {
  assets: SnapshotAsset[];
  routes: RouteAssets;
  misplaced?: string;
  externalSources: string[];
};

export const ASSET_INLINE_LIMIT = 32 * 1024;

export const EXTRA_ASSET_TYPES = ["m4v", "riv", "lottie", "glb"];

const ASSETS_DIR = "assets";

const ALWAYS_HOSTED = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg",
  ".lottie",
  ".riv",
  ".glb",
  ".wasm",
  ".woff2",
  ".woff",
  ".otf",
  ".ttf",
]);

export const alwaysHosted = (file: string): boolean =>
  ALWAYS_HOSTED.has(path.extname(file).toLowerCase());

const MIME: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".lottie": "application/zip",
  ".riv": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".wasm": "application/octet-stream",
};

export const mimeFor = (fileName: string): string =>
  MIME[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";

export const preloadAs = (mime: string): RouteAsset["as"] | undefined => {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("font/")) return "font";
  return undefined;
};

export const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

export const bufferOf = (source: Uint8Array | string): Buffer =>
  typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);

export const assetFileName = (info: { source?: Uint8Array | string }): string =>
  info.source === undefined ? "[hash][extname]" : `${sha256(bufferOf(info.source))}[extname]`;

const inside = (parent: string, file: string): boolean => {
  const relative = path.relative(parent, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const misplacedAssets = (
  assets: readonly SnapshotAsset[],
  superwallDir: string,
  surface: DiscoveredSurface,
): string | undefined => {
  const strays = assets.filter((asset) => {
    if (asset.path.split(path.sep).includes("node_modules")) return false;
    if (!inside(superwallDir, asset.path)) return false;
    const segments = path.relative(superwallDir, asset.path).split(path.sep);
    return !segments.slice(0, -1).includes(ASSETS_DIR);
  });
  if (strays.length === 0) return undefined;

  const here = path.relative(superwallDir, surface.dir).split(path.sep).join("/");
  const one = strays.length === 1;
  return [
    `${one ? "This file is" : "These files are"} hosted as ${one ? "an asset" : "assets"}, so ${
      one ? "it has" : "they have"
    } to live in an assets/ directory:`,
    ...strays.map(
      (asset) => `  ${path.relative(superwallDir, asset.path).split(path.sep).join("/")}`,
    ),
    `Move ${one ? "it" : "them"} to assets/ (shared by every surface) or ${here}/assets/.`,
  ].join("\n");
};

export const collectAssets = (
  root: string,
  superwallDir: string,
  surface: DiscoveredSurface,
  assetBaseUrl: string | undefined,
  onCollected: (collected: CollectedAssets) => void,
): Plugin => ({
  name: "superwall:route-assets",
  generateBundle(_options, bundle) {
    const bySource = new Map<string, SnapshotAsset>();
    const assets: SnapshotAsset[] = [];

    for (const output of Object.values(bundle)) {
      if (output.type !== "asset") continue;
      const originals = output.originalFileNames.map((name) => path.resolve(root, name));
      const bytes = bufferOf(output.source);
      const asset: SnapshotAsset = {
        fileName: output.fileName,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
        mime: mimeFor(output.fileName),
        path: originals[0] ?? output.fileName,
      };
      assets.push(asset);
      for (const original of originals) bySource.set(original, asset);
    }

    const reachable = (entry: string): SnapshotAsset[] => {
      const seen = new Set<string>();
      const found = new Map<string, SnapshotAsset>();
      const queue = [entry];
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        const asset = bySource.get(id.replace(/\?.*$/, ""));
        if (asset) found.set(asset.fileName, asset);
        const info = this.getModuleInfo(id);
        if (!info) continue;
        queue.push(...info.importedIds, ...info.dynamicallyImportedIds);
      }
      return [...found.values()];
    };

    const routes: RouteAssets = {};
    const attributed = new Set<string>();

    const entry = (asset: SnapshotAsset): RouteAsset | undefined => {
      const as = preloadAs(asset.mime);
      if (as === undefined || assetBaseUrl === undefined) return undefined;
      return { url: `${assetBaseUrl}/${asset.fileName}`, as };
    };

    for (const route of surface.routes) {
      const list: RouteAsset[] = [];
      for (const asset of reachable(route.file)) {
        attributed.add(asset.fileName);
        const item = entry(asset);
        if (item) list.push(item);
      }
      routes[route.name] = list;
    }

    const shared: RouteAsset[] = [];
    for (const asset of assets) {
      if (attributed.has(asset.fileName)) continue;
      const item = entry(asset);
      if (item) shared.push(item);
    }
    if (shared.length > 0) routes["*"] = shared;

    onCollected({
      assets,
      routes,
      misplaced:
        assetBaseUrl === undefined ? undefined : misplacedAssets(assets, superwallDir, surface),
      externalSources: externalSources(this.getModuleIds(), superwallDir),
    });
  },
});

export const injectRouteAssets = (html: string, routes: RouteAssets): string => {
  if (Object.keys(routes).length === 0) return html;
  const tag = `<script type="application/json" id="${ROUTE_ASSETS_ID}">${JSON.stringify(
    routes,
  ).replace(/</g, "\\u003c")}</script>`;
  const at = html.lastIndexOf("</body>");
  return at === -1 ? `${html}${tag}` : `${html.slice(0, at)}    ${tag}\n  ${html.slice(at)}`;
};
