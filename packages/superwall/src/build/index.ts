import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SuperwallConfig } from "@superwall/runtime";
import react from "@vitejs/plugin-react-swc";
import { build as viteBuild, defaultClientConditions } from "vite";
import type { SuperwallAppConfig } from "../config";
import { loadSurfaceConfig } from "../config/load";
import type { PaywallDefinition } from "../config/paywall";
import type { DiscoveredSurface, Project } from "../discover";
import { renderDocument } from "../document";

export type BuiltSnapshot = {
  surface: DiscoveredSurface;
  snapshotId: string;
  html: string;
  bytes: number;
  htmlFile: string;
  definition: PaywallDefinition | undefined;
  appConfig: SuperwallAppConfig | undefined;
  config: SuperwallConfig;
};

const relativeImport = (fromDir: string, file: string): string => {
  const relative = path.relative(fromDir, file).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const entrySource = (entryDir: string, project: Project, surface: DiscoveredSurface): string => {
  const imp = (file: string) => JSON.stringify(relativeImport(entryDir, file));
  const lines: string[] = [
    `import * as React from "react";`,
    `import { createRoot } from "react-dom/client";`,
    `import { SuperwallProvider, mergeMessages, mergeSurfaceConfig } from "superwall";`,
    `import { PaywallRouter } from "superwall/navigation";`,
  ];

  surface.pages.forEach((page, index) => {
    lines.push(`import Page${index} from ${imp(page.file)};`);
  });
  if (surface.layoutFile) lines.push(`import Layout from ${imp(surface.layoutFile)};`);
  if (surface.configFile) lines.push(`import definition from ${imp(surface.configFile)};`);
  else lines.push(`const definition = undefined;`);
  if (project.appConfigFile) lines.push(`import appConfig from ${imp(project.appConfigFile)};`);
  else lines.push(`const appConfig = undefined;`);

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
    `const merged = mergeSurfaceConfig(appConfig?.defaults, definition);`,
    `for (const [locale, catalog] of Object.entries(merged.localization?.messages ?? {})) {`,
    `  catalogs[locale] = mergeMessages(catalogs[locale], catalog);`,
    `}`,
    `const config = {`,
    `  ...merged,`,
    `  localization: {`,
    `    defaultLocale: merged.localization?.defaultLocale ?? "en",`,
    `    messages: catalogs,`,
    `  },`,
    `};`,
    `const routes = [${surface.pages
      .map((page, index) => `{ path: ${JSON.stringify(page.route)}, Component: Page${index} }`)
      .join(", ")}];`,
    ``,
    `createRoot(document.getElementById("root")).render(`,
    `  <React.StrictMode>`,
    `    <SuperwallProvider config={config} mock={definition?.preview ?? "auto"}>`,
    surface.layoutFile
      ? `      <PaywallRouter routes={routes} Layout={Layout} />`
      : `      <PaywallRouter routes={routes} />`,
    `    </SuperwallProvider>`,
    `  </React.StrictMode>,`,
    `);`,
  );

  return lines.join("\n");
};

const inlineAssets = (outDir: string): string => {
  let html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");

  html = html.replace(
    /<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g,
    (_match, asset: string) =>
      `<script type="module">${fs.readFileSync(path.join(outDir, asset), "utf8")}</script>`,
  );
  html = html.replace(
    /<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g,
    (_match, asset: string) =>
      `<style>${fs.readFileSync(path.join(outDir, asset), "utf8")}</style>`,
  );
  html = html.replace(/<link rel="modulepreload"[^>]*>\n?/g, "");

  return html;
};

/**
 * Builds one surface into a self-contained, content-addressed snapshot.
 * `superwall push` calls this through `superwall/build`.
 */
export const buildSnapshot = async (
  project: Project,
  surface: DiscoveredSurface,
): Promise<BuiltSnapshot> => {
  const entryDir = path.join(project.root, ".superwall/entries", surface.kind, surface.id);
  const outDir = path.join(project.root, ".superwall/dist", surface.kind, surface.id);
  fs.mkdirSync(entryDir, { recursive: true });

  const { definition, appConfig, config } = await loadSurfaceConfig(project, surface);

  fs.writeFileSync(path.join(entryDir, "entry.jsx"), entrySource(entryDir, project, surface));
  fs.writeFileSync(
    path.join(entryDir, "index.html"),
    renderDocument({ title: `${surface.id} — superwall`, config, entry: "./entry.jsx" }),
  );

  await viteBuild({
    configFile: false,
    envFile: false,
    root: entryDir,
    base: "./",
    logLevel: "warn",
    plugins: [react()],
    resolve: {
      conditions: ["superwall-ts", ...defaultClientConditions],
      dedupe: ["react", "react-dom"],
      alias: { "@": project.superwallDir },
    },
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });

  const html = inlineAssets(outDir);
  const htmlFile = path.join(outDir, "snapshot.html");
  fs.writeFileSync(htmlFile, html);

  return {
    surface,
    snapshotId: createHash("sha256").update(html).digest("hex"),
    html,
    bytes: Buffer.byteLength(html),
    htmlFile,
    definition,
    appConfig,
    config,
  };
};
