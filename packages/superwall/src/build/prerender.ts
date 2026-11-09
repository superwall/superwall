import * as fs from "node:fs";
import * as path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { MessageChannel } from "node:worker_threads";
import { JSDOM, VirtualConsole } from "jsdom";
import { build as viteBuild, type InlineConfig, type Rollup } from "vite";
import { assetFileName } from "./assets";
import { PRERENDER_GLOBAL, entrySource, type EntrySourceOptions } from "./entry";
import { isStripeProductIdentifier } from "../checkout/products";
import { NO_PRODUCT, isTeleportPageReference, teleportPageKey } from "../checkout/teleport/pages";

export { NO_PRODUCT, teleportPageKey };

export type TeleportPage = { key: string; html: string };

export type TeleportPageVariant = {
  key: string;
  locale: string;
  productReference?: string;
  hasIntroductoryOffer: boolean;
};

export type PrerenderedTeleportPages = {
  locales: string[];
  pages: TeleportPage[];
  warnings: string[];
};

export const MAX_TELEPORT_PAGES = 200;
export const MAX_TELEPORT_PAGE_BYTES = 256 * 1024;
export const PRERENDER_URL = "https://prerender.superwall.invalid/teleport/prerender";

const PAGE_LOCALE = /^[A-Za-z0-9-]+$/;

export const stripeReferencesOf = (products: Record<string, string>): string[] =>
  Object.entries(products)
    .filter(
      ([reference, identifier]) =>
        isStripeProductIdentifier(identifier) && isTeleportPageReference(reference),
    )
    .map(([reference]) => reference);

export const teleportPageVariants = (
  defaultLocale: string,
  locales: readonly string[],
  references: readonly string[],
): { locales: string[]; variants: TeleportPageVariant[]; warnings: string[] } => {
  const warnings: string[] = [];
  const named = [...new Set([defaultLocale, ...locales])];
  const invalid = named.filter((locale) => !PAGE_LOCALE.test(locale));
  if (invalid.length > 0) {
    warnings.push(
      `No teleport page for ${invalid.map((locale) => `\`${locale}\``).join(", ")}: a page's locale is letters, digits and hyphens.`,
    );
  }
  const valid = named.filter((locale) => PAGE_LOCALE.test(locale));
  const perLocale = (references.length + 1) * 2;
  const fits = Math.floor(MAX_TELEPORT_PAGES / perLocale);
  const kept = valid.slice(0, fits);
  if (kept.length < valid.length) {
    warnings.push(
      `Teleport pages stop at ${MAX_TELEPORT_PAGES}: ${valid
        .slice(fits)
        .map((locale) => `\`${locale}\``)
        .join(", ")} load without one.`,
    );
  }
  const variants = kept.flatMap((locale) =>
    [undefined, ...references].flatMap((productReference) =>
      [true, false].map((hasIntroductoryOffer) => ({
        key: teleportPageKey(locale, productReference, hasIntroductoryOffer),
        locale,
        ...(productReference === undefined ? {} : { productReference }),
        hasIntroductoryOffer,
      })),
    ),
  );
  return { locales: kept, variants, warnings };
};

type PrerenderWindow = Window &
  typeof globalThis & { __SW_TELEPORT__?: unknown; [PRERENDER_GLOBAL]?: () => string };

export const renderTeleportPage = (
  code: string,
  route: string,
  variant: TeleportPageVariant,
): string => {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    {
      url: PRERENDER_URL,
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    },
  );
  const window = dom.window as PrerenderWindow;
  const channels: MessageChannel[] = [];
  class ClosedAfterRender extends MessageChannel {
    constructor() {
      super();
      channels.push(this);
    }
  }
  try {
    Object.assign(window, { TextEncoder, TextDecoder, MessageChannel: ClosedAfterRender });
    window.__SW_TELEPORT__ = {
      id: "prerender",
      route,
      hasIntroductoryOffer: variant.hasIntroductoryOffer,
      ...(variant.productReference === undefined
        ? {}
        : { productReference: variant.productReference }),
      variables: { deviceProperties: { deviceLocale: variant.locale } },
    };
    window.eval(code);
    const render = window[PRERENDER_GLOBAL];
    if (typeof render !== "function") throw new Error("the pre-render bundle exported nothing");
    return render();
  } finally {
    for (const channel of channels) {
      channel.port1.close();
      channel.port2.close();
    }
    dom.window.close();
  }
};

const bundledCode = (output: unknown): string => (output as Rollup.RollupOutput).output[0].code;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type PrerenderOptions = {
  entry: Omit<EntrySourceOptions, "target">;
  vite: InlineConfig;
  route: string;
  defaultLocale: string;
  locales: readonly string[];
  products: Record<string, string>;
};

export const prerenderTeleportPages = async ({
  entry,
  vite,
  route,
  defaultLocale,
  locales,
  products,
}: PrerenderOptions): Promise<PrerenderedTeleportPages> => {
  const none: PrerenderedTeleportPages = { locales: [], pages: [], warnings: [] };
  if (!entry.surface.routes.some((candidate) => candidate.name === route)) {
    return {
      ...none,
      warnings: [
        `teleport.route \`${route}\` is no route of this ${entry.surface.kind}: no teleport pages.`,
      ],
    };
  }
  const stripe = stripeReferencesOf(products);
  const priced = stripe.filter((reference) => entry.inlineProducts?.[reference] !== undefined);
  const unpriced = stripe.filter((reference) => !priced.includes(reference));
  const planned = teleportPageVariants(defaultLocale, locales, priced);
  if (unpriced.length > 0) {
    planned.warnings.push(
      `No teleport page for ${unpriced.map((reference) => `\`${reference}\``).join(", ")}: this build has no store price for ${unpriced.length === 1 ? "it" : "them"}, so the page would show none. \`superwall push\` prices them.`,
    );
  }

  const file = path.join(entry.entryDir, "prerender.jsx");
  fs.writeFileSync(file, entrySource({ ...entry, target: "prerender" }));

  let code: string;
  try {
    code = bundledCode(
      await viteBuild({
        ...vite,
        build: {
          ...vite.build,
          write: false,
          emptyOutDir: false,
          cssCodeSplit: false,
          assetsDir: "",
          rollupOptions: {
            input: file,
            output: { format: "iife", inlineDynamicImports: true, assetFileNames: assetFileName },
          },
        },
      }),
    );
  } catch (error) {
    return {
      ...none,
      warnings: [
        ...planned.warnings,
        `Teleport pages were not pre-rendered (${messageOf(error)}); the teleport page renders in the browser.`,
      ],
    };
  }

  const pages: TeleportPage[] = [];
  const failures = new Set<string>();
  for (const variant of planned.variants) {
    try {
      const html = renderTeleportPage(code, route, variant);
      if (Buffer.byteLength(html) > MAX_TELEPORT_PAGE_BYTES) {
        failures.add(`\`${variant.key}\` is over ${MAX_TELEPORT_PAGE_BYTES / 1024} KB`);
        continue;
      }
      pages.push({ key: variant.key, html });
    } catch (error) {
      failures.add(messageOf(error));
    }
  }

  const warnings = [...planned.warnings];
  if (failures.size > 0) {
    warnings.push(
      `Some teleport pages were not pre-rendered and render in the browser instead: ${[...failures].join("; ")}.`,
    );
  }
  return { locales: pages.length === 0 ? [] : planned.locales, pages, warnings };
};
