import type { PaywallDetail, PaywallProductRef } from "@/core/api/resources";

export type OriginPresentation =
  | { style: "fullscreen" | "modal" | "push" | "noAnimation" }
  | { style: "drawer"; height?: number; cornerRadius?: number }
  | { style: "popup"; width?: number; height?: number; cornerRadius?: number };

export interface OriginSettings {
  presentation: OriginPresentation;
  featureGating: "gated" | "nonGated";
  scrollEnabled: boolean;
  gameControllerEnabled: boolean;
  onDeviceCacheEnabled: boolean;
  webCheckoutDestination?: string;
}

export interface OriginInventory {
  pages: number;
  drawers: number;
  nodes: Record<string, number>;
  actions: Record<string, number>;
  variables: string[];
}

export interface OriginDocument {
  settings: Partial<OriginSettings>;
  background?: { light: string; dark?: string };
  locales: string[];
  inventory: OriginInventory;
}

export interface OriginPaywall {
  id: string;
  name: string;
  slug: string;
  identifier?: string;
  applicationId?: string;
  projectId?: string;
  platform?: "ios" | "android" | "web";
  url?: string;
  previewUrl?: string;
  products: PaywallProductRef[];
  settings: OriginSettings;
  background?: { light: string; dark?: string };
  locales: string[];
  inventory?: OriginInventory;
}

const ACTIONS = [
  "purchase",
  "restore",
  "close",
  "open-url",
  "navigate-page",
  "set-state",
  "set-attribute",
  "set-product-index",
  "custom-placement",
  "custom-in-app",
  "request-permission",
  "request-store-review",
  "redeem-discount",
  "redeem-purchase",
  "select-choice",
  "select-indicator",
  "focus-input",
  "scroll-to-element",
  "teleport-to-web",
] as const;

const DOCUMENT_SCRIPT = /<script id="vike_pageContext" type="application\/json">([\s\S]*?)<\/script>/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findStore = (value: unknown, depth = 0): Record<string, unknown> | undefined => {
  if (depth > 8 || !isRecord(value)) return undefined;
  if (isRecord(value.store) && isRecord(value.schema)) return value.store;
  for (const entry of Object.values(value)) {
    const found = findStore(entry, depth + 1);
    if (found) return found;
  }
  return undefined;
};

const hex = (value: string): string =>
  value.length === 9 && value.toLowerCase().endsWith("ff") ? value.slice(0, 7) : value;

const backgroundOf = (html: string): OriginDocument["background"] => {
  const light = /html\s*\{\s*background-color:\s*(#[0-9a-fA-F]{6,8})/.exec(html)?.[1];
  if (!light) return undefined;
  const dark = /html\.dark\s*\{\s*background-color:\s*(#[0-9a-fA-F]{6,8})/.exec(html)?.[1];
  return dark && dark !== light ? { light: hex(light), dark: hex(dark) } : { light: hex(light) };
};

const presentationOf = (value: unknown): OriginPresentation | undefined => {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  const number = (entry: unknown) => (typeof entry === "number" ? entry : undefined);
  switch (value.type) {
    case "FULLSCREEN":
      return { style: "fullscreen" };
    case "MODAL":
      return { style: "modal" };
    case "PUSH":
      return { style: "push" };
    case "NO_ANIMATION":
      return { style: "noAnimation" };
    case "DRAWER":
      return {
        style: "drawer",
        height: number(value.height),
        cornerRadius: number(value.cornerRadius),
      };
    case "POPUP":
      return {
        style: "popup",
        width: number(value.width),
        height: number(value.height),
        cornerRadius: number(value.cornerRadius),
      };
    default:
      return undefined;
  }
};

const enabled = (value: unknown): boolean | undefined =>
  value === "ENABLED" ? true : value === "DISABLED" ? false : undefined;

export function parseOriginDocument(html: string): OriginDocument | undefined {
  const json = DOCUMENT_SCRIPT.exec(html)?.[1];
  if (json === undefined) return undefined;
  let context: unknown;
  try {
    context = JSON.parse(json);
  } catch {
    return undefined;
  }
  const store = findStore(context);
  if (!store) return undefined;

  const records = Object.values(store).filter(isRecord);
  const ofType = (typeName: string) => records.filter((record) => record.typeName === typeName);
  const paywall = ofType("paywall")[0];
  const nodes = ofType("node");

  const settings: Partial<OriginSettings> = {};
  if (paywall) {
    const presentation =
      presentationOf(paywall.presentationStyleV3) ??
      presentationOf({ type: paywall.presentationStyle });
    if (presentation) settings.presentation = presentation;
    if (paywall.featureGating === "GATED") settings.featureGating = "gated";
    if (paywall.featureGating === "NON_GATED") settings.featureGating = "nonGated";
    const scroll = enabled(paywall.isScrollEnabled);
    if (scroll !== undefined) settings.scrollEnabled = scroll;
    const controller = enabled(paywall.gameControllerSupport);
    if (controller !== undefined) settings.gameControllerEnabled = controller;
    const cache = enabled(paywall.onDeviceCache);
    if (cache !== undefined) settings.onDeviceCacheEnabled = cache;
    if (typeof paywall.webCheckoutDestination === "string") {
      settings.webCheckoutDestination = paywall.webCheckoutDestination;
    }
  }

  const locales = ofType("paywall_language")
    .map((record) => (typeof record.id === "string" ? record.id.split(":")[1] : undefined))
    .filter((locale): locale is string => typeof locale === "string" && locale !== "")
    .sort();

  const nodeCounts: Record<string, number> = {};
  for (const node of nodes) {
    if (typeof node.type !== "string") continue;
    nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;
  }
  const navigationIds = new Set(
    nodes.filter((node) => node.type === "navigation").map((node) => node.id),
  );
  const pages = nodes.filter((node) => navigationIds.has(node.parentId)).length;

  const serialized = JSON.stringify(store);
  const actions: Record<string, number> = {};
  for (const action of ACTIONS) {
    const count = serialized.split(`"type":"${action}"`).length - 1;
    if (count > 0) actions[action] = count;
  }
  const seen = new Set<string>();
  serialized.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_match, expression: string) => {
    seen.add(expression.replace(/\\"/g, '"').trim());
    return "";
  });
  const variables = [...seen].sort();

  return {
    settings,
    background: backgroundOf(html),
    locales,
    inventory: {
      pages: Math.max(pages, 1),
      drawers: nodeCounts.drawer ?? 0,
      nodes: nodeCounts,
      actions,
      variables,
    },
  };
}

const PLATFORMS = new Set(["ios", "android", "web"]);

const platformOf = (value: string | undefined): OriginPaywall["platform"] =>
  value !== undefined && PLATFORMS.has(value) ? (value as OriginPaywall["platform"]) : undefined;

const apiPresentation = (value: string | undefined): OriginPresentation => {
  switch (value) {
    case "modal":
      return { style: "modal" };
    case "push":
      return { style: "push" };
    case "no_animation":
      return { style: "noAnimation" };
    case "drawer":
      return { style: "drawer" };
    case "popup":
      return { style: "popup" };
    default:
      return { style: "fullscreen" };
  }
};

export function slugOf(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "paywall" : slug;
}

export function originOf(detail: PaywallDetail, document?: OriginDocument): OriginPaywall {
  const name = detail.name ?? `Paywall ${detail.id}`;
  return {
    id: detail.id,
    name,
    slug: slugOf(name),
    identifier: detail.identifier,
    applicationId: detail.applicationId,
    projectId: detail.projectId,
    platform: platformOf(detail.platform),
    url: detail.url,
    previewUrl: detail.previewUrl,
    products: detail.products,
    settings: {
      presentation: document?.settings.presentation ?? apiPresentation(detail.presentationStyle),
      featureGating:
        document?.settings.featureGating ?? (detail.featureGating === "gated" ? "gated" : "nonGated"),
      scrollEnabled: document?.settings.scrollEnabled ?? true,
      gameControllerEnabled: document?.settings.gameControllerEnabled ?? false,
      onDeviceCacheEnabled: document?.settings.onDeviceCacheEnabled ?? true,
      ...(document?.settings.webCheckoutDestination === undefined
        ? {}
        : { webCheckoutDestination: document.settings.webCheckoutDestination }),
    },
    background: document?.background,
    locales: document?.locales ?? [],
    inventory: document?.inventory,
  };
}

const literal = (value: string): string => JSON.stringify(value);

const presentationSource = (presentation: OriginPresentation): string | undefined => {
  if (presentation.style === "fullscreen") return undefined;
  if (presentation.style === "drawer") {
    const geometry = [
      presentation.height === undefined ? undefined : `height: ${presentation.height}`,
      presentation.cornerRadius === undefined
        ? undefined
        : `cornerRadius: ${presentation.cornerRadius}`,
    ].filter((entry) => entry !== undefined);
    return geometry.length === 0
      ? `{ style: "drawer" }`
      : `{ style: "drawer", drawer: { ${geometry.join(", ")} } }`;
  }
  if (presentation.style === "popup") {
    const geometry = [
      presentation.width === undefined ? undefined : `width: ${presentation.width}`,
      presentation.height === undefined ? undefined : `height: ${presentation.height}`,
      presentation.cornerRadius === undefined
        ? undefined
        : `cornerRadius: ${presentation.cornerRadius}`,
    ].filter((entry) => entry !== undefined);
    return geometry.length === 0
      ? `{ style: "popup" }`
      : `{ style: "popup", popup: { ${geometry.join(", ")} } }`;
  }
  return `{ style: ${literal(presentation.style)} }`;
};

const checkoutSource = (origin: OriginPaywall): string | undefined => {
  if (origin.platform !== "web") return undefined;
  if (origin.settings.webCheckoutDestination === "PAYWALL_APPLE_PAY") return `"applePay"`;
  if (origin.settings.webCheckoutDestination === "PAYWALL_EMBEDDED") return `"sheet"`;
  return undefined;
};

export function originConfigSource(origin: OriginPaywall): string {
  const lines: string[] = [`  name: ${literal(origin.name)},`];
  if (origin.platform) lines.push(`  platforms: [${literal(origin.platform)}],`);
  if (origin.products.length > 0) {
    lines.push(`  products: {`);
    for (const product of origin.products) {
      const key = /^[A-Za-z_$][\w$]*$/.test(product.reference)
        ? product.reference
        : literal(product.reference);
      lines.push(`    ${key}: ${literal(product.identifier)},`);
    }
    lines.push(`  },`);
  }
  const checkout = checkoutSource(origin);
  if (checkout) lines.push(`  checkout: ${checkout},`);
  const presentation = presentationSource(origin.settings.presentation);
  if (presentation) lines.push(`  presentation: ${presentation},`);
  if (origin.background) {
    lines.push(
      origin.background.dark
        ? `  background: { light: ${literal(origin.background.light)}, dark: ${literal(origin.background.dark)} },`
        : `  background: ${literal(origin.background.light)},`,
    );
  }
  if (origin.settings.featureGating === "gated") lines.push(`  featureGating: "gated",`);
  if (!origin.settings.scrollEnabled) lines.push(`  scrollEnabled: false,`);
  if (origin.settings.gameControllerEnabled) lines.push(`  gameControllerEnabled: true,`);
  if (!origin.settings.onDeviceCacheEnabled) lines.push(`  onDeviceCacheEnabled: false,`);
  return `import { definePaywall } from "superwall/config";\n\nexport default definePaywall({\n${lines.join("\n")}\n});\n`;
}

const table = (rows: string[][]): string => rows.map((row) => `| ${row.join(" | ")} |`).join("\n");

export function originBrief(origin: OriginPaywall): string {
  const products =
    origin.products.length === 0
      ? "_The dashboard lists no products for this paywall._"
      : `${table([
          ["Reference", "Store", "Identifier"],
          ["---", "---", "---"],
          ...origin.products.map((product) => [
            `\`${product.reference}\``,
            product.store ?? "",
            product.identifier === "missing"
              ? "**missing** — pick a real product before pushing"
              : `\`${product.identifier}\``,
          ]),
        ])}`;
  const inventory = origin.inventory;
  const counts = (record: Record<string, number>) =>
    Object.entries(record)
      .sort(([, a], [, b]) => b - a)
      .map(([key, count]) => `${key} ×${count}`)
      .join(", ");
  const inventoryText = inventory
    ? [
        `- Pages: ${inventory.pages}${inventory.pages > 1 ? " (children of the editor's navigation element — one route each)" : ""}`,
        `- Drawers: ${inventory.drawers}`,
        `- Elements: ${counts(inventory.nodes) || "none"}`,
        `- Actions: ${counts(inventory.actions) || "none"}`,
        `- Product variables in text: ${inventory.variables.length === 0 ? "none" : inventory.variables.map((entry) => `\`{{ ${entry} }}\``).join(", ")}`,
        `- Locales: ${origin.locales.length === 0 ? "none beyond the default" : origin.locales.join(", ")}`,
      ].join("\n")
    : "_The served document could not be read; inventory it from the URL above before building._";

  return `# Migrating "${origin.name}" to code

Rebuild this dashboard paywall as a framework paywall. Follow the
\`superwall-framework\` skill's migration playbook
(\`references/migrate-from-editor.md\`); this file is its input and is
deleted when the migration is done.

## Source

- Dashboard paywall: ${origin.id}${origin.identifier ? ` (\`${origin.identifier}\`)` : ""}
- Served document: ${origin.url ?? "unknown"}
- Screenshot: ${origin.previewUrl ?? "none"}
- Platform: ${origin.platform ?? "unknown"}
- Presentation: ${origin.settings.presentation.style}

## Products

${products}

## Inventory

${inventoryText}

## What \`config.ts\` already carries

Name, platform, products, presentation, feature gating, scrolling, game
controller, on-device cache${origin.background ? ", background" : ""}${origin.locales.length > 0 ? ", and the locales to provide catalogs for" : ""}. Everything under \`app/\` is the
starter and has to be rebuilt from the source.

## Done when

- Every page, state and locale of the source is rebuilt, verified side by
  side against **Original** in the studio's Compare menu, in both schemes.
- The user has reviewed it and asked for the push.
- This file is deleted. The dashboard paywall keeps serving until a campaign
  points at the new one.
`;
}
