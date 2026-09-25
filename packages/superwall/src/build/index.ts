import * as fs from "node:fs";
import * as path from "node:path";
import {
  backgroundOf,
  checkoutModeOf,
  normalizePlatform,
  type SuperwallConfig,
} from "@superwall/runtime";
import react from "@vitejs/plugin-react-swc";
import { build as viteBuild } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import {
  ASSET_INLINE_LIMIT,
  EXTRA_ASSET_TYPES,
  alwaysHosted,
  assetFileName,
  collectAssets,
  injectRouteAssets,
  sha256,
  type CollectedAssets,
  type SnapshotAsset,
} from "./assets";
import { entrySource } from "./entry";
import { resolveConfigProducts, resolveProductIds } from "./products";
import { paywallSettingsOf, type PaywallSettings } from "./settings";
import { loadSurfaceConfig } from "../config/load";
import { localesOf } from "../config/messages";
import type { PaywallDefinition } from "../config/paywall";
import type { DiscoveredSurface, Project } from "../discover";
import { renderDocument } from "../document";

export * from "./assets";
export * from "./products";
export { entrySource, type EntrySourceOptions } from "./entry";

export type BuiltSnapshot = {
  surface: DiscoveredSurface;
  name: string;
  products: Record<string, string>;
  checkout: ReturnType<typeof checkoutModeOf>;
  background: ReturnType<typeof backgroundOf>;
  settings: PaywallSettings;
  locales: string[];
  snapshotId: string;
  html: string;
  bytes: number;
  htmlFile: string;
  definition: PaywallDefinition | undefined;
  config: SuperwallConfig;
  assets: SnapshotAsset[];
  assetBytes: number;
  externalSources: string[];
};

export type BuildOptions = {
  assetBaseUrl?: string;
  platform?: string;
};

export const titleCase = (id: string): string =>
  id
    .split(/[-_]/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const buildSnapshot = async (
  project: Project,
  surface: DiscoveredSurface,
  options: BuildOptions = {},
): Promise<BuiltSnapshot> => {
  const { assetBaseUrl } = options;
  const platform = normalizePlatform(options.platform);
  const variant = platform === undefined ? [] : [platform];
  const entryDir = path.join(
    project.superwallDir,
    ".superwall/entries",
    surface.kind,
    surface.id,
    ...variant,
  );
  const outDir = path.join(
    project.superwallDir,
    ".superwall/dist",
    surface.kind,
    surface.id,
    ...variant,
  );
  fs.mkdirSync(entryDir, { recursive: true });

  const { definition, config } = await loadSurfaceConfig(surface);
  const products = resolveProductIds(config, surface, platform);
  const settings = paywallSettingsOf(config, platform);
  const locales = localesOf(project, surface, definition);

  fs.writeFileSync(
    path.join(entryDir, "entry.jsx"),
    entrySource({
      entryDir,
      project,
      surface,
      config,
      products: platform === undefined ? undefined : products,
    }),
  );
  fs.writeFileSync(
    path.join(entryDir, "index.html"),
    renderDocument({ title: `${surface.id} — superwall`, config, entry: "./entry.jsx" }),
  );

  let collected: CollectedAssets = { assets: [], routes: {}, externalSources: [] };

  await viteBuild({
    configFile: false,
    envFile: false,
    root: entryDir,
    base: "./",
    logLevel: "warn",
    assetsInclude: EXTRA_ASSET_TYPES.map((extension) => `**/*.${extension}`),
    plugins: [
      react(),
      ...(platform === undefined ? [] : [resolveConfigProducts(surface.configFile, products)]),
      collectAssets(entryDir, project.superwallDir, surface, assetBaseUrl, (value) => {
        collected = value;
      }),
      viteSingleFile({ useRecommendedBuildConfig: false, removeViteModuleLoader: true }),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: { "@": project.superwallDir },
    },
    ...(assetBaseUrl === undefined
      ? {}
      : { experimental: { renderBuiltUrl: (filename) => `${assetBaseUrl}/${filename}` } }),
    build: {
      outDir,
      emptyOutDir: true,
      assetsDir: "",
      cssCodeSplit: false,
      assetsInlineLimit:
        assetBaseUrl === undefined
          ? Number.MAX_SAFE_INTEGER
          : (filePath: string, content: Buffer) =>
              alwaysHosted(filePath) ? false : content.length <= ASSET_INLINE_LIMIT,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          assetFileNames: assetFileName,
        },
      },
    },
  });

  if (collected.misplaced !== undefined) throw new Error(collected.misplaced);

  const html = injectRouteAssets(
    fs.readFileSync(path.join(outDir, "index.html"), "utf8"),
    collected.routes,
  );
  const htmlFile = path.join(outDir, "snapshot.html");
  fs.writeFileSync(htmlFile, html);

  return {
    surface,
    name: definition?.name?.trim() || titleCase(surface.id),
    products,
    checkout: checkoutModeOf(config.checkout),
    background: backgroundOf(config.background),
    settings,
    snapshotId: sha256(html),
    html,
    bytes: Buffer.byteLength(html),
    htmlFile,
    definition,
    config,
    locales,
    assets: collected.assets,
    assetBytes: collected.assets.reduce((total, asset) => total + asset.bytes, 0),
    externalSources: collected.externalSources,
  };
};
