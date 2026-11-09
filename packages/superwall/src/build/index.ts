import * as fs from "node:fs";
import * as path from "node:path";
import {
  backgroundOf,
  checkoutModeOf,
  normalizePlatform,
  teleportOf,
  type SuperwallBillingPlan,
  type SuperwallConfig,
} from "@superwall/runtime";
import react from "@vitejs/plugin-react-swc";
import { build as viteBuild, type InlineConfig } from "vite";
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
import { assertBundlerBuilds } from "./bundler";
import { entrySource, type EntrySourceOptions } from "./entry";
import { prerenderTeleportPages, type TeleportPage } from "./prerender";
import {
  inlineProductsOf,
  resolveBillingPlans,
  resolveConfigProducts,
  resolveProductIds,
  type ProductCatalogue,
} from "./products";
import { paywallSettingsOf, type PaywallSettings } from "./settings";
import { loadSurfaceConfig } from "../config/load";
import { localesOf } from "../config/messages";
import type { PaywallDefinition } from "../config/paywall";
import type { DiscoveredSurface, Project } from "../discover";
import { renderDocument, withModuleScriptsLast, withTeleportPages } from "../document";

export * from "./assets";
export * from "./products";
export { entrySource, type EntrySourceOptions } from "./entry";
export * from "./prerender";

export type BuiltSnapshot = {
  surface: DiscoveredSurface;
  name: string;
  products: Record<string, string>;
  billingPlans: Record<string, SuperwallBillingPlan>;
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
  teleportRoute: string | undefined;
  teleportPages: TeleportPage[];
  warnings: string[];
};

export type BuildOptions = {
  assetBaseUrl?: string;
  platform?: string;
  catalogue?: ProductCatalogue;
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
  assertBundlerBuilds();
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
  const billingPlans = resolveBillingPlans(config, surface, platform);
  const settings = paywallSettingsOf(config);
  const locales = localesOf(project, surface, definition);

  const entry: Omit<EntrySourceOptions, "target"> = {
    entryDir,
    project,
    surface,
    config,
    products: platform === undefined ? undefined : products,
    inlineProducts:
      platform === undefined ? undefined : inlineProductsOf(products, options.catalogue),
  };
  fs.writeFileSync(path.join(entryDir, "entry.jsx"), entrySource(entry));
  fs.writeFileSync(
    path.join(entryDir, "index.html"),
    renderDocument({ title: `${surface.id} — superwall`, config, entry: "./entry.jsx" }),
  );

  let collected: CollectedAssets = { assets: [], routes: {}, externalSources: [] };

  const shared: InlineConfig = {
    configFile: false,
    envFile: false,
    root: entryDir,
    base: "./",
    logLevel: "warn",
    assetsInclude: EXTRA_ASSET_TYPES.map((extension) => `**/*.${extension}`),
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    plugins: [
      react(),
      ...(platform === undefined ? [] : [resolveConfigProducts(surface.configFile, products)]),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: { "@": project.superwallDir },
    },
    ...(assetBaseUrl === undefined
      ? {}
      : { experimental: { renderBuiltUrl: (filename) => `${assetBaseUrl}/${filename}` } }),
    build: {
      assetsInlineLimit:
        assetBaseUrl === undefined
          ? Number.MAX_SAFE_INTEGER
          : (filePath: string, content: Buffer) =>
              alwaysHosted(filePath) ? false : content.length <= ASSET_INLINE_LIMIT,
    },
  };

  await viteBuild({
    ...shared,
    plugins: [
      ...(shared.plugins ?? []),
      collectAssets(entryDir, project.superwallDir, surface, assetBaseUrl, (value) => {
        collected = value;
      }),
      viteSingleFile({ useRecommendedBuildConfig: false, removeViteModuleLoader: true }),
    ],
    build: {
      ...shared.build,
      outDir,
      emptyOutDir: true,
      assetsDir: "",
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          assetFileNames: assetFileName,
        },
      },
    },
  });

  if (collected.misplaced !== undefined) throw new Error(collected.misplaced);

  const route = teleportOf(config.teleport)?.route;
  const prerendered =
    platform === undefined || route === undefined
      ? { locales: [], pages: [], warnings: [] }
      : await prerenderTeleportPages({
          entry,
          vite: shared,
          route,
          defaultLocale: config.localization?.defaultLocale ?? "en",
          locales,
          products,
        });

  const html = withTeleportPages(
    withModuleScriptsLast(
      injectRouteAssets(fs.readFileSync(path.join(outDir, "index.html"), "utf8"), collected.routes),
    ),
    prerendered.locales,
  );
  const htmlFile = path.join(outDir, "snapshot.html");
  fs.writeFileSync(htmlFile, html);

  return {
    surface,
    name: definition?.name?.trim() || titleCase(surface.id),
    products,
    billingPlans,
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
    teleportRoute: route,
    teleportPages: prerendered.pages,
    warnings: prerendered.warnings,
  };
};
