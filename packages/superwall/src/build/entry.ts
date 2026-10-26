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
};

export const entrySource = ({
  entryDir,
  project,
  surface,
  config,
  products,
  inlineProducts,
}: EntrySourceOptions): string => {
  const imp = (file: string) => JSON.stringify(relativeImport(entryDir, file));
  const teleport = config.teleport !== undefined;
  const checkout = checkoutNeedsPaymentUi(config.checkout) || teleport;
  const lines: string[] = [
    `import * as React from "react";`,
    `import { createRoot } from "react-dom/client";`,
    `import { SuperwallProvider } from "superwall";`,
    `import { mergeMessages } from "superwall/internal";`,
    `import { PaywallRouter } from "superwall/navigation";`,
    ...(checkout
      ? [
          teleport
            ? `import { SuperwallCheckout, TeleportScreen } from "superwall/checkout";`
            : `import { SuperwallCheckout } from "superwall/checkout";`,
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
    `createRoot(document.getElementById("root")).render(`,
    `  <React.StrictMode>`,
    inlineProducts === undefined || Object.keys(inlineProducts).length === 0
      ? `    <SuperwallProvider config={config}>`
      : `    <SuperwallProvider config={config} inlineProducts={${JSON.stringify(inlineProducts)}}>`,
    `      <PaywallRouter ${routerProps} />`,
    ...(checkout ? [`      <SuperwallCheckout />`] : []),
    ...(teleport ? [`      <TeleportScreen />`] : []),
    `    </SuperwallProvider>`,
    `  </React.StrictMode>,`,
    `);`,
  );

  return lines.join("\n");
};
