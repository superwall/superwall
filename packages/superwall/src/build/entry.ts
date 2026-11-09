import * as path from "node:path";
import type { SuperwallConfig } from "@superwall/runtime";
import { checkoutNeedsPaymentUi } from "./settings";
import type { DiscoveredSurface, Project } from "../discover";

const relativeImport = (fromDir: string, file: string): string => {
  const relative = path.relative(fromDir, file).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

export type EntrySourceOptions = {
  entryDir: string;
  project: Project;
  surface: DiscoveredSurface;
  config: SuperwallConfig;
  products?: Record<string, string>;
  inlineProducts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  target?: "client" | "prerender";
};

export const PRERENDER_GLOBAL = "__SW_PRERENDER__";

export const entrySource = ({
  entryDir,
  project,
  surface,
  config,
  products,
  inlineProducts,
  target = "client",
}: EntrySourceOptions): string => {
  const prerender = target === "prerender";
  const imp = (file: string) => JSON.stringify(relativeImport(entryDir, file));
  const teleport = config.teleport !== undefined;
  const checkout = checkoutNeedsPaymentUi(config.checkout) || teleport;
  const lines: string[] = [
    `import * as React from "react";`,
    ...(prerender
      ? [`import { renderToString } from "react-dom/server";`]
      : teleport
        ? []
        : [`import { createRoot } from "react-dom/client";`]),
    `import { SuperwallProvider } from "superwall";`,
    teleport && !prerender
      ? `import { mergeMessages, mountApp } from "superwall/internal";`
      : `import { mergeMessages } from "superwall/internal";`,
    `import { PaywallRouter } from "superwall/navigation";`,
    ...(checkout
      ? [
          `import { ${[
            "SuperwallCheckout",
            ...(teleport ? ["TeleportScreen"] : []),
            ...(teleport && !prerender ? ["markTeleportScriptStart"] : []),
          ].join(", ")} } from "superwall/checkout";`,
        ]
      : []),
  ];

  surface.routes.forEach((route, index) => {
    lines.push(`import * as Route${index} from ${imp(route.file)};`);
  });
  if (surface.layoutFile) lines.push(`import * as layout from ${imp(surface.layoutFile)};`);
  lines.push(`import definition from ${imp(surface.configFile)};`);

  const catalogs: string[] = [];
  [...project.sharedMessages, ...surface.messages].forEach((entry, index) => {
    lines.push(`import messages${index} from ${imp(entry.file)};`);
    catalogs.push(`[${JSON.stringify(entry.locale)}, messages${index}]`);
  });

  const routerProps = [
    `routes={routes}`,
    ...(surface.layoutFile ? [`Layout={Layout}`, `entry={entry}`] : []),
    `transition={definition?.transition}`,
    `queryState={definition?.queryState}`,
    `navigationId={${JSON.stringify(surface.id)}}`,
  ].join(" ");

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
    ...(surface.layoutFile ? [`const { default: Layout, entry } = { ...layout };`] : []),
    `const routes = {${surface.routes
      .map((route, index) => `${JSON.stringify(route.name)}: Route${index}`)
      .join(", ")}};`,
    ``,
    ...(teleport && !prerender ? [`markTeleportScriptStart();`] : []),
    prerender
      ? `globalThis.${PRERENDER_GLOBAL} = () => renderToString(`
      : teleport
        ? `mountApp(document.getElementById("root"), (`
        : `createRoot(document.getElementById("root")).render(`,
    `  <React.StrictMode>`,
    inlineProducts === undefined || Object.keys(inlineProducts).length === 0
      ? `    <SuperwallProvider config={config}>`
      : `    <SuperwallProvider config={config} inlineProducts={${JSON.stringify(inlineProducts)}}>`,
    `      <PaywallRouter ${routerProps} />`,
    ...(checkout ? [`      <SuperwallCheckout />`] : []),
    ...(teleport ? [`      <TeleportScreen />`] : []),
    `    </SuperwallProvider>`,
    teleport && !prerender
      ? `  </React.StrictMode>), config);`
      : `  </React.StrictMode>,`,
    ...(teleport && !prerender ? [] : [`);`]),
  );

  return lines.join("\n");
};
