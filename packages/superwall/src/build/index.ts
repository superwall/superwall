import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  backgroundOf,
  checkoutModeOf,
  checkoutNeedsPaymentUi,
  isPlatformProductIds,
  normalizePlatform,
  paywallSettingsOf,
  productIdFor,
  type PaywallSettings,
  type SuperwallConfig,
  type SuperwallPlatform,
} from "@superwall/runtime";
import react from "@vitejs/plugin-react-swc";
import { build as viteBuild, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { externalSources } from "./externality";
import { loadSurfaceConfig } from "../config/load";
import type { PaywallDefinition } from "../config/paywall";
import type { DiscoveredSurface, Project } from "../discover";
import { renderDocument } from "../document";

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

export type BuiltSnapshot = {
  surface: DiscoveredSurface;
  name: string;
  products: Record<string, string>;
  checkout: ReturnType<typeof checkoutModeOf>;
  background: ReturnType<typeof backgroundOf>;
  settings: PaywallSettings;
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

export const resolveProductIds = (
  config: SuperwallConfig,
  surface: DiscoveredSurface,
  platform: SuperwallPlatform | undefined,
): Record<string, string> => {
  const missing: string[] = [];
  const resolved = Object.entries(config.products ?? {}).map(([reference, input]) => {
    const id = productIdFor(input, platform);
    if (id === undefined && platform !== undefined && isPlatformProductIds(input)) {
      missing.push(reference);
    }
    return [reference, id ?? reference] as const;
  });
  if (missing.length > 0) {
    throw new Error(
      `${surface.kind}s/${surface.id}: ${missing.map((reference) => `\`${reference}\``).join(", ")} ` +
        `${missing.length === 1 ? "has" : "have"} no product id for ${platform} — add one in config.ts, ` +
        `or drop ${platform} from this ${surface.kind}'s platforms.`,
    );
  }
  return Object.fromEntries(resolved);
};

const hasRange = (node: object): node is { start: number; end: number } =>
  "start" in node &&
  typeof node.start === "number" &&
  "end" in node &&
  typeof node.end === "number";

export const rewriteConfigProducts = (
  code: string,
  program: { body: readonly { type: string }[] },
  products: Record<string, string>,
): string | undefined => {
  for (const statement of program.body) {
    if (statement.type !== "ExportDefaultDeclaration" || !("declaration" in statement)) continue;
    let object: unknown = statement.declaration;
    if (
      typeof object === "object" &&
      object !== null &&
      "type" in object &&
      object.type === "CallExpression" &&
      "arguments" in object &&
      Array.isArray(object.arguments)
    ) {
      object = object.arguments[0];
    }
    if (
      typeof object !== "object" ||
      object === null ||
      !("type" in object) ||
      object.type !== "ObjectExpression" ||
      !("properties" in object) ||
      !Array.isArray(object.properties)
    ) {
      return undefined;
    }
    for (const property of object.properties) {
      if (typeof property !== "object" || property === null) continue;
      if (!("type" in property) || property.type !== "Property" || !("key" in property)) continue;
      const key: unknown = property.key;
      const name =
        typeof key === "object" && key !== null && "type" in key
          ? key.type === "Identifier" && "name" in key
            ? key.name
            : key.type === "Literal" && "value" in key
              ? key.value
              : undefined
          : undefined;
      if (name !== "products" || !("value" in property)) continue;
      const value: unknown = property.value;
      if (typeof value !== "object" || value === null || !hasRange(value)) return undefined;
      return `${code.slice(0, value.start)}${JSON.stringify(products)}${code.slice(value.end)}`;
    }
    return undefined;
  }
  return undefined;
};

const resolveConfigProducts = (configFile: string, products: Record<string, string>): Plugin => ({
  name: "superwall:config-products",
  enforce: "post",
  transform(code, id) {
    if (id.split("?")[0] !== configFile) return null;
    const rewritten = rewriteConfigProducts(code, this.parse(code), products);
    return rewritten === undefined ? null : { code: rewritten, map: null };
  },
});

export const ROUTE_ASSETS_ID = "sw-route-assets";

export const ASSET_INLINE_LIMIT = 32 * 1024;

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

const alwaysHosted = (file: string): boolean => ALWAYS_HOSTED.has(path.extname(file).toLowerCase());

export const EXTRA_ASSET_TYPES = ["m4v", "riv", "lottie", "glb"];

const ASSETS_DIR = "assets";

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

const mimeFor = (fileName: string): string =>
  MIME[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";

const preloadAs = (mime: string): RouteAsset["as"] | undefined => {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("font/")) return "font";
  return undefined;
};

const titleCase = (id: string): string =>
  id
    .split(/[-_]/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

const bufferOf = (source: Uint8Array | string): Buffer =>
  typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);

const relativeImport = (fromDir: string, file: string): string => {
  const relative = path.relative(fromDir, file).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const entrySource = (
  entryDir: string,
  project: Project,
  surface: DiscoveredSurface,
  config: SuperwallConfig,
  products?: Record<string, string>,
): string => {
  const imp = (file: string) => JSON.stringify(relativeImport(entryDir, file));
  const checkout = checkoutNeedsPaymentUi(config.checkout);
  const lines: string[] = [
    `import * as React from "react";`,
    `import { createRoot } from "react-dom/client";`,
    `import { SuperwallProvider } from "superwall";`,
    `import { mergeMessages } from "superwall/internal";`,
    `import { PaywallRouter } from "superwall/navigation";`,
    ...(checkout ? [`import { SuperwallCheckout } from "superwall/checkout";`] : []),
  ];

  surface.routes.forEach((route, index) => {
    lines.push(`import * as Route${index} from ${imp(route.file)};`);
  });
  if (surface.layoutFile) lines.push(`import Layout from ${imp(surface.layoutFile)};`);
  if (surface.configFile) lines.push(`import definition from ${imp(surface.configFile)};`);
  else lines.push(`const definition = undefined;`);

  const catalogs: string[] = [];
  [...project.sharedMessages, ...surface.messages].forEach((entry, index) => {
    lines.push(`import messages${index} from ${imp(entry.file)};`);
    catalogs.push(`[${JSON.stringify(entry.locale)}, messages${index}]`);
  });

  lines.push(
    ``,
    `const catalogs = {};`,
    `for (const [locale, catalog] of [${catalogs.join(", ")}]) {`,
    `  catalogs[locale] = mergeMessages(catalogs[locale], catalog);`,
    `}`,
    `const merged = definition ?? {};`,
    `for (const [locale, catalog] of Object.entries(merged.localization?.messages ?? {})) {`,
    `  catalogs[locale] = mergeMessages(catalogs[locale], catalog);`,
    `}`,
    `const config = {`,
    `  ...merged,`,
    ...(products === undefined ? [] : [`  products: ${JSON.stringify(products)},`]),
    `  localization: {`,
    `    defaultLocale: merged.localization?.defaultLocale ?? "en",`,
    `    messages: catalogs,`,
    `  },`,
    `};`,
    `const routes = {${surface.routes
      .map((route, index) => `${JSON.stringify(route.name)}: Route${index}`)
      .join(", ")}};`,
    ``,
    `createRoot(document.getElementById("root")).render(`,
    `  <React.StrictMode>`,
    `    <SuperwallProvider config={config} mock="auto">`,
    surface.layoutFile
      ? `      <PaywallRouter routes={routes} Layout={Layout} transition={definition?.transition} queryState={definition?.queryState} navigationId={${JSON.stringify(surface.id)}} />`
      : `      <PaywallRouter routes={routes} transition={definition?.transition} queryState={definition?.queryState} navigationId={${JSON.stringify(surface.id)}} />`,
    ...(checkout ? [`      <SuperwallCheckout />`] : []),
    `    </SuperwallProvider>`,
    `  </React.StrictMode>,`,
    `);`,
  );

  return lines.join("\n");
};

type Collected = {
  assets: SnapshotAsset[];
  routes: RouteAssets;
  misplaced?: string;
  externalSources: string[];
};

const inside = (parent: string, file: string): boolean => {
  const relative = path.relative(parent, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const misplaced = (
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
  return [
    `${strays.length === 1 ? "This file is" : "These files are"} hosted as ${
      strays.length === 1 ? "an asset" : "assets"
    }, so ${strays.length === 1 ? "it has" : "they have"} to live in an assets/ directory:`,
    ...strays.map(
      (asset) => `  ${path.relative(superwallDir, asset.path).split(path.sep).join("/")}`,
    ),
    `Move ${strays.length === 1 ? "it" : "them"} to assets/ (shared by every surface) or ${here}/assets/.`,
  ].join("\n");
};

const collectAssets = (
  root: string,
  superwallDir: string,
  surface: DiscoveredSurface,
  assetBaseUrl: string | undefined,
  onCollected: (collected: Collected) => void,
): Plugin => ({
  name: "superwall:route-assets",
  generateBundle(_options, bundle) {
    const bySource = new Map<string, SnapshotAsset>();
    const assets: SnapshotAsset[] = [];

    for (const output of Object.values(bundle)) {
      if (output.type !== "asset") continue;
      const originals = (output.originalFileNames ?? []).map((name) => path.resolve(root, name));
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
        const asset = bySource.get(id.split("?")[0] ?? id);
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
      if (list.length > 0) routes[route.name] = list;
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
      misplaced: assetBaseUrl === undefined ? undefined : misplaced(assets, superwallDir, surface),
      externalSources: externalSources(this.getModuleIds(), superwallDir),
    });
  },
});

const injectRouteAssets = (html: string, routes: RouteAssets): string => {
  if (Object.keys(routes).length === 0) return html;
  const tag = `<script type="application/json" id="${ROUTE_ASSETS_ID}">${JSON.stringify(
    routes,
  ).replace(/</g, "\\u003c")}</script>`;
  const at = html.lastIndexOf("</body>");
  return at === -1 ? `${html}${tag}` : `${html.slice(0, at)}    ${tag}\n  ${html.slice(at)}`;
};

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
  const settings = paywallSettingsOf(config);

  fs.writeFileSync(
    path.join(entryDir, "entry.jsx"),
    entrySource(entryDir, project, surface, config, platform === undefined ? undefined : products),
  );
  fs.writeFileSync(
    path.join(entryDir, "index.html"),
    renderDocument({ title: `${surface.id} — superwall`, config, entry: "./entry.jsx" }),
  );

  let collected: Collected = { assets: [], routes: {}, externalSources: [] };

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
    experimental: {
      renderBuiltUrl(filename, { type }) {
        if (type === "asset" && assetBaseUrl !== undefined) {
          return `${assetBaseUrl}/${filename}`;
        }
        return undefined;
      },
    },
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
          assetFileNames: (info) =>
            info.source === undefined
              ? "[hash][extname]"
              : `${sha256(bufferOf(info.source))}[extname]`,
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
    assets: collected.assets,
    assetBytes: collected.assets.reduce((total, asset) => total + asset.bytes, 0),
    externalSources: collected.externalSources,
  };
};
