// @vitest-environment node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { TextDecoder, TextEncoder } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildSnapshot,
  MAX_TELEPORT_PAGES,
  prerenderTeleportPages,
  renderTeleportPage,
  stripeReferencesOf,
  teleportPageKey,
  teleportPageVariants,
  type BuiltSnapshot,
} from "../../src/build";
import { discoverProject } from "../../src/discover";
import { PRERENDER_ATTRIBUTE, withTeleportPages } from "../../src/document";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture");

const project = () => discoverProject(FIXTURE);
const surface = (id: string) => {
  const found = project().surfaces.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture lost its ${id} paywall`);
  return found;
};

const catalogue = {
  "stripe|live:price_annual": { price: "$59.99" },
  "stripe|live:price_monthly": { price: "$9.99" },
};

const page = (built: BuiltSnapshot, key: string): string => {
  const found = built.teleportPages.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no page ${key} — got ${built.teleportPages.map((p) => p.key)}`);
  return found.html;
};

const main = (html: string) => /<main>.*?<\/main>/.exec(html)?.[0];

describe("teleport page keys", () => {
  it("names a page by locale, tapped product or none, and trial", () => {
    expect(teleportPageKey("pt-BR", "annual", true)).toBe("pt-BR/annual/1");
    expect(teleportPageKey("en", undefined, false)).toBe("en/__none__/0");
  });

  it("pre-renders only Stripe products whose reference fits a key", () => {
    expect(
      stripeReferencesOf({
        annual: "stripe|live:price_1",
        test: "test:price_2",
        store: "pro_999_month",
        "has space": "live:price_3",
        __none__: "live:price_4",
        "..": "live:price_5",
        ".": "live:price_6",
        "v1.2": "live:price_7",
      }),
    ).toEqual(["annual", "test", "v1.2"]);
  });

  it("puts the default locale first and renders every product, none and both trials per locale", () => {
    const { locales, variants, warnings } = teleportPageVariants("en", ["de", "en"], ["annual"]);
    expect(locales).toEqual(["en", "de"]);
    expect(variants.map((variant) => variant.key)).toEqual([
      "en/__none__/1",
      "en/__none__/0",
      "en/annual/1",
      "en/annual/0",
      "de/__none__/1",
      "de/__none__/0",
      "de/annual/1",
      "de/annual/0",
    ]);
    expect(variants[2]).toEqual({
      key: "en/annual/1",
      locale: "en",
      productReference: "annual",
      hasIntroductoryOffer: true,
    });
    expect(warnings).toEqual([]);
  });

  it("skips a locale no key can name, and says so", () => {
    const { locales, warnings } = teleportPageVariants("en", ["pt_BR"], []);
    expect(locales).toEqual(["en"]);
    expect(warnings).toEqual([
      "No teleport page for `pt_BR`: a page's locale is letters, digits and hyphens.",
    ]);
  });

  it("stops at the page limit, keeping the default locale, and names the locales left out", () => {
    const many = Array.from({ length: 30 }, (_, index) => `l${index}`);
    const { locales, variants, warnings } = teleportPageVariants("en", many, ["a", "b", "c", "d"]);
    expect(variants.length).toBeLessThanOrEqual(MAX_TELEPORT_PAGES);
    expect(locales[0]).toBe("en");
    expect(locales).toHaveLength(20);
    expect(warnings[0]).toMatch(/^Teleport pages stop at 200: `l19`, /);
  });
});

describe("the document names its pages", () => {
  const document = `<html><head><meta charset="utf-8"><meta name="sw-teleport-boot" content="1"><title>x</title></head></html>`;

  it("lists the default locale and the rest right after the boot meta", () => {
    expect(withTeleportPages(document, ["en", "de"])).toContain(
      `<meta name="sw-teleport-boot" content="1"><meta name="sw-teleport-pages" content="en de">`,
    );
  });

  it("is unchanged when there are no pages", () => {
    expect(withTeleportPages(document, [])).toBe(document);
  });

  it("opens the head when the document has no boot meta", () => {
    expect(withTeleportPages("<html><head><title>x</title></head></html>", ["en"])).toBe(
      `<html><head><meta name="sw-teleport-pages" content="en"><title>x</title></head></html>`,
    );
  });
});

describe("pre-rendering the teleport route", () => {
  let built: BuiltSnapshot;

  beforeAll(async () => {
    built = await buildSnapshot(project(), surface("teleport"), { platform: "ios", catalogue });
  }, 120_000);

  it("renders a page per locale, Stripe product or none, and trial, and nothing for a store product", () => {
    expect(built.warnings).toEqual([]);
    expect(built.teleportPages.map((teleportPage) => teleportPage.key).toSorted()).toEqual(
      [
        "de/__none__/0",
        "de/__none__/1",
        "de/annual/0",
        "de/annual/1",
        "de/monthly/0",
        "de/monthly/1",
        "en/__none__/0",
        "en/__none__/1",
        "en/annual/0",
        "en/annual/1",
        "en/monthly/0",
        "en/monthly/1",
      ].toSorted(),
    );
  });

  it("draws the teleport route in the page's locale, with the tapped product's price and the trial", () => {
    expect(main(page(built, "de/annual/1"))).toBe(
      `<main><h1>Jetzt abschließen</h1><p data-product="annual">$59.99</p><p>Trial included</p></main>`,
    );
    expect(main(page(built, "en/monthly/0"))).toBe(
      `<main><h1>Finish checkout</h1><p data-product="monthly">$9.99</p><p>No trial</p></main>`,
    );
    expect(main(page(built, "en/__none__/0"))).toBe(
      `<main><h1>Finish checkout</h1><p data-product="none">Pick a plan</p><p>No trial</p></main>`,
    );
  });

  it("is the inside of #root, opened on the teleport route", () => {
    const html = page(built, "en/annual/1");
    expect(html).not.toContain("<html");
    expect(html).not.toContain('id="root"');
    expect(html).toContain('data-sw-route="checkout"');
    expect(html).not.toContain('data-sw-route="index"');
  });

  it("puts #root ahead of the inline app script, so a page the worker puts there paints first", () => {
    const root = built.html.indexOf('<div id="root">');
    expect(root).toBeGreaterThan(0);
    expect(root).toBeLessThan(built.html.indexOf('<script type="module"'));
    expect(root).toBeGreaterThan(built.html.indexOf("<style"));
  });

  it("tells the worker which locales have pages, default first", () => {
    expect(built.html).toContain(`<meta name="sw-teleport-pages" content="en de">`);
  });

  it("writes the document that names its pages, and ids it by that html", () => {
    expect(fs.readFileSync(built.htmlFile, "utf8")).toBe(built.html);
  });

  const openTeleportPage = async (key: string | undefined, locale: string, tapped?: string) => {
    const script = /<script type="module"[^>]*>([\s\S]*?)<\/script>/.exec(built.html)?.[1];
    if (script === undefined) throw new Error("the document has no inline script");
    const filled = key === undefined ? "" : page(built, key);
    const attribute = key === undefined ? "" : ` ${PRERENDER_ATTRIBUTE}="${key}"`;
    const errors: unknown[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("error", (...args: unknown[]) => errors.push(args));
    const dom = new JSDOM(
      `<!doctype html><html><head></head><body><div id="root"${attribute}>${filled}</div></body></html>`,
      {
        url: "https://example.superwall.app/teleport/tp",
        runScripts: "outside-only",
        pretendToBeVisual: true,
        virtualConsole,
      },
    );
    const window = dom.window as unknown as Window &
      typeof globalThis & { __SW_TELEPORT__?: unknown };
    Object.assign(window, { TextEncoder, TextDecoder });
    window.addEventListener("error", (event) => errors.push(event.error ?? event.message));
    window.__SW_TELEPORT__ = {
      id: "v1:tp",
      route: "checkout",
      hasIntroductoryOffer: true,
      ...(tapped === undefined ? {} : { productReference: tapped }),
      variables: { deviceProperties: { deviceLocale: locale } },
    };
    const root = window.document.getElementById("root")!;
    const before = root.querySelector("main");
    window.eval(script.replaceAll("import.meta.url", "location.href"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = root.querySelector("main");
    const result = {
      before,
      after,
      html: after?.outerHTML,
      attribute: root.getAttribute(PRERENDER_ATTRIBUTE),
      errors,
    };
    dom.window.close();
    return result;
  };

  it("hydrates the page the worker put in #root, keeping its nodes and drawing the same frame", async () => {
    const opened = await openTeleportPage("de/annual/1", "de-DE", "annual");
    expect(opened.before).not.toBeNull();
    expect(opened.after).toBe(opened.before);
    expect(opened.html).toBe(main(page(built, "de/annual/1")));
    expect(opened.attribute).toBeNull();
    expect(opened.errors).toEqual([]);
  });

  it("throws away a page for another state and renders the shopper's own frame", async () => {
    const opened = await openTeleportPage("en/monthly/0", "de-DE", "annual");
    expect(opened.before).not.toBeNull();
    expect(opened.after).not.toBe(opened.before);
    expect(opened.html).toBe(main(page(built, "de/annual/1")));
  });

  it("renders in the browser as before when the worker sent no page", async () => {
    const opened = await openTeleportPage(undefined, "en-US");
    expect(opened.before).toBeNull();
    expect(opened.html).toBe(main(page(built, "en/__none__/1")));
  });
});

describe("when there is nothing to pre-render", () => {
  it("renders no pages without a platform, as the preview builds", async () => {
    const built = await buildSnapshot(project(), surface("teleport"), {});
    expect(built.teleportRoute).toBe("checkout");
    expect(built.teleportPages).toEqual([]);
    expect(built.warnings).toEqual([]);
    expect(built.html).not.toContain("sw-teleport-pages");
  }, 120_000);

  it("renders no product's page without its store price, and says how to get one", async () => {
    const built = await buildSnapshot(project(), surface("teleport"), { platform: "ios" });
    expect(built.teleportPages.map((teleportPage) => teleportPage.key).toSorted()).toEqual(
      ["de/__none__/0", "de/__none__/1", "en/__none__/0", "en/__none__/1"].toSorted(),
    );
    expect(built.warnings).toEqual([
      "No teleport page for `annual`, `monthly`: this build has no store price for them, so the page would show none. `superwall push` prices them.",
    ]);
  }, 120_000);

  it("renders no pages for a paywall without teleport.route", async () => {
    const built = await buildSnapshot(project(), surface("stores"), { platform: "ios" });
    expect(built.teleportRoute).toBeUndefined();
    expect(built.teleportPages).toEqual([]);
    expect(built.warnings).toEqual([]);
  }, 120_000);
});

describe("a pre-render that fails", () => {
  it("keeps the pages that rendered and warns about the rest, never failing the build", async () => {
    const built = await buildSnapshot(project(), surface("edge"), { platform: "ios", catalogue });
    expect(built.teleportPages.map((teleportPage) => teleportPage.key).toSorted()).toEqual([
      "en/__none__/0",
      "en/__none__/1",
      "en/annual/0",
      "en/annual/1",
    ]);
    expect(built.warnings).toHaveLength(1);
    expect(built.warnings[0]).toContain("render in the browser instead");
    expect(built.warnings[0]).toContain("`en/monthly/1` is over 256 KB");
    expect(built.warnings[0]).toContain("this route reads the browser");
    expect(built.html).toContain(`<meta name="sw-teleport-pages" content="en de">`);
  }, 120_000);

  it("warns and renders nothing when the route is no route of the paywall", async () => {
    const edge = surface("edge");
    const result = await prerenderTeleportPages({
      entry: { entryDir: FIXTURE, project: project(), surface: edge, config: {} },
      vite: {},
      route: "nowhere",
      defaultLocale: "en",
      locales: [],
      products: {},
    });
    expect(result).toEqual({
      locales: [],
      pages: [],
      warnings: ["teleport.route `nowhere` is no route of this paywall: no teleport pages."],
    });
  });

  it("warns and renders nothing when the pre-render bundle does not build", async () => {
    const edge = surface("edge");
    const entryDir = fs.mkdtempSync(path.join(FIXTURE, "superwall/.superwall/prerender-"));
    try {
      const result = await prerenderTeleportPages({
        entry: {
          entryDir,
          project: project(),
          surface: edge,
          config: { teleport: { route: "checkout" } },
        },
        vite: {
          configFile: false,
          root: entryDir,
          logLevel: "silent",
          plugins: [
            {
              name: "refuses",
              buildStart() {
                throw new Error("the bundler refused");
              },
            },
          ],
        },
        route: "checkout",
        defaultLocale: "en",
        locales: [],
        products: {},
      });
      expect(result.pages).toEqual([]);
      expect(result.locales).toEqual([]);
      expect(result.warnings).toEqual([
        expect.stringMatching(
          /^Teleport pages were not pre-rendered \(.*the bundler refused.*\); the teleport page renders in the browser\.$/s,
        ),
      ]);
    } finally {
      fs.rmSync(entryDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("says so when a bundle sets no renderer", () => {
    expect(() =>
      renderTeleportPage("void 0", "checkout", {
        key: "en/__none__/0",
        locale: "en",
        hasIntroductoryOffer: false,
      }),
    ).toThrow("the pre-render bundle exported nothing");
  });
});
