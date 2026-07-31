// @vitest-environment node
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSnapshot, type BuiltSnapshot, type SnapshotAsset } from "../../src/build";
import { discoverProject } from "../../src/discover";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture");
const BASE = "https://user-content.test/user-content/hl/42";

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const project = () => discoverProject(FIXTURE);
const surface = (id = "demo") => {
  const found = project().surfaces.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture lost its ${id} paywall`);
  return found;
};

const byName = (assets: readonly SnapshotAsset[], base: string): SnapshotAsset => {
  const found = assets.find((asset) => path.basename(asset.path) === base);
  if (!found) throw new Error(`no emitted asset for ${base} — got ${assets.map((a) => a.path)}`);
  return found;
};

const routeAssets = (html: string): Record<string, { url: string; as: string }[]> => {
  const match = /<script type="application\/json" id="sw-route-assets">(.*?)<\/script>/s.exec(html);
  return match?.[1] ? JSON.parse(match[1]) : {};
};

const markup = (html: string): string =>
  html
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/g, "$1$2");

const externalTags = (html: string) => {
  const tags = markup(html);
  return {
    scripts: [...tags.matchAll(/<script[^>]*\ssrc=/g)].length,
    stylesheets: [...tags.matchAll(/<link[^>]*rel="stylesheet"/g)].length,
    modulepreloads: [...tags.matchAll(/modulepreload/g)].length,
  };
};

describe("hosted assets", () => {
  let built: BuiltSnapshot;

  beforeAll(async () => {
    built = await buildSnapshot(project(), surface(), { assetBaseUrl: BASE });
  }, 120_000);

  it("emits every asset over the inline limit, named by the sha256 of its bytes", () => {
    expect(built.assets.map((asset) => path.basename(asset.path)).toSorted()).toEqual([
      "bg.png",
      "clip.mp4",
      "hero.png",
      "hero.riv",
      "spinner.lottie",
      "tiny.mp4",
    ]);

    for (const asset of built.assets) {
      const digest = sha256(asset.path);
      expect(asset.sha256).toBe(digest);
      expect(asset.fileName).toBe(`${digest}${path.extname(asset.path)}`);
      expect(asset.bytes).toBe(fs.statSync(asset.path).size);
    }
    expect(built.assetBytes).toBe(built.assets.reduce((total, asset) => total + asset.bytes, 0));
  });

  it("carries the mime type each asset will be served with", () => {
    expect(byName(built.assets, "hero.png").mime).toBe("image/png");
    expect(byName(built.assets, "clip.mp4").mime).toBe("video/mp4");
    expect(byName(built.assets, "bg.png").mime).toBe("image/png");
    expect(byName(built.assets, "spinner.lottie").mime).toBe("application/zip");
    expect(byName(built.assets, "hero.riv").mime).toBe("application/octet-stream");
  });

  it("hosts player payloads vite has never heard of, at any size", () => {
    const lottie = byName(built.assets, "spinner.lottie");
    const rive = byName(built.assets, "hero.riv");

    for (const asset of [lottie, rive]) {
      expect(asset.bytes).toBeLessThan(32 * 1024);
      expect(asset.fileName).toBe(`${sha256(asset.path)}${path.extname(asset.path)}`);
      expect(built.html).toContain(`${BASE}/${asset.fileName}`);
    }
    expect(built.html).not.toContain("data:application/zip");
    expect(built.html).not.toContain("data:application/octet-stream");
  });

  it("leaves exotic payloads out of the prefetch map — the SDK manifest pre-caches them", () => {
    const routes = routeAssets(built.html);
    const exotic = [
      byName(built.assets, "spinner.lottie").fileName,
      byName(built.assets, "hero.riv").fileName,
    ];

    const prefetched = Object.values(routes).flatMap((list) => list.map((item) => item.url));
    for (const fileName of exotic) {
      expect(prefetched).not.toContain(`${BASE}/${fileName}`);
    }
  });

  it("bakes absolute URLs into the document — a relative one would resolve against the host page", () => {
    for (const asset of built.assets) {
      expect(built.html).toContain(`${BASE}/${asset.fileName}`);
    }
    expect(built.html).not.toMatch(/src="\.\/[a-f0-9]{64}\./);
  });

  it("still inlines anything under the limit", () => {
    expect(built.html).toContain("data:image/svg+xml");
    expect(built.assets.some((asset) => asset.path.endsWith("spark.svg"))).toBe(false);
  });

  it("ships one file: no external script, stylesheet, or modulepreload survives", () => {
    expect(externalTags(built.html)).toEqual({
      scripts: 0,
      stylesheets: 0,
      modulepreloads: 0,
    });
    expect(fs.existsSync(built.htmlFile)).toBe(true);
  });

  it("maps each screen to the assets that screen needs", () => {
    const routes = routeAssets(built.html);
    const hero = byName(built.assets, "hero.png");
    const clip = byName(built.assets, "clip.mp4");
    const tiny = byName(built.assets, "tiny.mp4");
    const bg = byName(built.assets, "bg.png");

    expect(routes["index"]).toEqual([{ url: `${BASE}/${hero.fileName}`, as: "image" }]);
    expect(routes["offer"]).toEqual([
      { url: `${BASE}/${clip.fileName}`, as: "video" },
      { url: `${BASE}/${tiny.fileName}`, as: "video" },
    ]);
    expect(routes["*"]).toEqual([{ url: `${BASE}/${bg.fileName}`, as: "image" }]);
  });

  it("hosts video at any size — a data URI can never serve a Range request", () => {
    const tiny = byName(built.assets, "tiny.mp4");

    expect(tiny.bytes).toBeLessThan(32 * 1024);
    expect(built.html).toContain(`${BASE}/${tiny.fileName}`);
    expect(built.html).not.toContain("data:video/mp4;base64,");
  });

  it("bundles the layout and every message catalog the surface inherits", () => {
    expect(built.html).toContain("demo-shell");
    expect(built.html).toContain("Demo paywall");
    expect(built.html).toContain("Muro de pago");
    expect(built.html).toContain("Demo");
  });

  it("is content-addressed over the finished document", () => {
    expect(built.snapshotId).toBe(createHash("sha256").update(built.html).digest("hex"));
    expect(built.bytes).toBe(Buffer.byteLength(built.html));
  });
});

describe("the assets/ convention", () => {
  it("refuses to host a file that is not in an assets/ directory", async () => {
    const failure = await buildSnapshot(project(), surface("stray"), {
      assetBaseUrl: BASE,
    }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(failure).toBeDefined();
    expect(failure).toContain("paywalls/stray/components/wide.png");
    expect(failure).toContain("assets/ (shared by every surface)");
    expect(failure).toContain("paywalls/stray/assets/");
  });

  it("says nothing about assets small enough to inline, wherever they sit", async () => {
    const built = await buildSnapshot(project(), surface("tiny"), { assetBaseUrl: BASE });

    expect(built.assets).toEqual([]);
    expect(built.html).toContain("data:image/svg+xml");
  });

  it("does not apply when nothing is hosted in the first place", async () => {
    const built = await buildSnapshot(project(), surface("stray"));

    expect(built.assets).toEqual([]);
    expect(built.html).toContain("data:image/png;base64,");
  });
}, 180_000);

describe("without a host to serve from", () => {
  let built: BuiltSnapshot;

  beforeAll(async () => {
    built = await buildSnapshot(project(), surface());
  }, 120_000);

  it("inlines everything and emits nothing", () => {
    expect(built.assets).toEqual([]);
    expect(built.assetBytes).toBe(0);
    expect(built.html).toContain("data:image/png;base64,");
    expect(built.html).toContain("data:video/mp4;base64,");
  });

  it("has no route map to prefetch from", () => {
    expect(markup(built.html)).not.toContain("sw-route-assets");
    expect(routeAssets(built.html)).toEqual({});
  });

  it("is still one self-contained file", () => {
    expect(externalTags(built.html)).toEqual({
      scripts: 0,
      stylesheets: 0,
      modulepreloads: 0,
    });
    expect(built.html).not.toContain("https://user-content.test");
  });
});

describe("the externality scan", () => {
  it("finds nothing in a self-contained project — not the framework, not node_modules", async () => {
    const built = await buildSnapshot(project(), surface());

    expect(built.externalSources).toEqual([]);
  }, 120_000);
});

describe("build artifacts", () => {
  it("stay inside superwallDir, where dedupe can see the project's own install", async () => {
    const discovered = project();
    const built = await buildSnapshot(discovered, surface("tiny"));

    expect(discovered.superwallDir).toBe(path.join(FIXTURE, "superwall"));
    expect(built.htmlFile.startsWith(path.join(discovered.superwallDir, ".superwall"))).toBe(true);
    expect(
      fs.existsSync(path.join(discovered.superwallDir, ".superwall/entries/paywall/tiny")),
    ).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE, ".superwall"))).toBe(false);
  }, 120_000);
});

describe("checkout is bundled only where it is asked for", () => {
  const stripeIsPresent = (html: string) =>
    html.includes("js.stripe.com") || html.includes("checkout-sheet-wrapper");

  it("keeps Stripe out of a paywall that never mentions checkout", async () => {
    const built = await buildSnapshot(project(), surface("tiny"), {});

    expect(stripeIsPresent(built.html)).toBe(false);
  }, 120_000);

  it("carries the sheet into a paywall configured for it", async () => {
    const built = await buildSnapshot(project(), surface("paid"), {});

    expect(built.html).toContain("js.stripe.com");
    expect(built.html).toContain("checkout-sheet-wrapper");
  }, 120_000);

  it("carries it for applePay too, which falls back to the same sheet", async () => {
    const built = await buildSnapshot(project(), surface("wallet"), {});

    expect(built.html).toContain("js.stripe.com");
    expect(built.html).toContain("checkout-sheet-wrapper");
  }, 120_000);

  it("costs an external-checkout paywall nothing, since it only ever navigates", async () => {
    // `external` leaves for a hosted page, so the payment UI would be dead
    // weight. These three paywalls render identical markup and differ only in
    // the config key, so any difference in bytes is the payment UI itself.
    const plain = await buildSnapshot(project(), surface("basic"), {});
    const external = await buildSnapshot(project(), surface("hosted"), {});
    const sheet = await buildSnapshot(project(), surface("paid"), {});

    expect(stripeIsPresent(external.html)).toBe(false);
    // Not byte-identical: the config itself rides in the snapshot, so the
    // word "external" costs a few bytes. What must not appear is payment UI.
    expect(external.bytes - plain.bytes).toBeLessThan(200);
    expect(sheet.bytes - external.bytes).toBeGreaterThan(20_000);
  }, 120_000);
});
