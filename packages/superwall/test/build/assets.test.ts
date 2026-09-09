// @vitest-environment node
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  alwaysHosted,
  assetFileName,
  collectAssets,
  injectRouteAssets,
  mimeFor,
  misplacedAssets,
  preloadAs,
  sha256,
  type CollectedAssets,
  type SnapshotAsset,
} from "../../src/build/assets";
import type { DiscoveredSurface } from "../../src/discover";

describe("asset classification", () => {
  it("maps extensions to MIME types and falls back to octet-stream", () => {
    expect(mimeFor("hero.PNG")).toBe("image/png");
    expect(mimeFor("song.mp3")).toBe("audio/mpeg");
    expect(mimeFor("model.unknown")).toBe("application/octet-stream");
  });

  it("chooses a preload kind by MIME family", () => {
    expect(preloadAs("image/webp")).toBe("image");
    expect(preloadAs("video/mp4")).toBe("video");
    expect(preloadAs("audio/aac")).toBe("audio");
    expect(preloadAs("font/woff2")).toBe("font");
    expect(preloadAs("application/zip")).toBeUndefined();
  });

  it("always hosts media and fonts, whatever their size", () => {
    expect(alwaysHosted("/x/clip.MP4")).toBe(true);
    expect(alwaysHosted("/x/type.woff2")).toBe(true);
    expect(alwaysHosted("/x/icon.png")).toBe(false);
  });
});

const surface = (dir: string): DiscoveredSurface => ({
  kind: "paywall",
  id: "pro",
  dir,
  configFile: path.join(dir, "config.ts"),
  routes: [
    { name: "index", file: path.join(dir, "app/index.tsx") },
    { name: "plans", file: path.join(dir, "app/plans.tsx") },
  ],
  messages: [],
  diagnostics: [],
});

const asset = (file: string, mime = "image/png"): SnapshotAsset => ({
  fileName: path.basename(file),
  sha256: "x",
  bytes: 1,
  mime,
  path: file,
});

describe("misplacedAssets", () => {
  const superwallDir = "/app/superwall";
  const pro = surface("/app/superwall/paywalls/pro");

  it("accepts files under any assets/ directory, node_modules, and files outside the project", () => {
    expect(
      misplacedAssets(
        [
          asset("/app/superwall/assets/hero.png"),
          asset("/app/superwall/paywalls/pro/assets/hero.png"),
          asset("/app/superwall/node_modules/pkg/hero.png"),
          asset("/elsewhere/hero.png"),
        ],
        superwallDir,
        pro,
      ),
    ).toBeUndefined();
  });

  it("names a single stray in the singular", () => {
    expect(misplacedAssets([asset("/app/superwall/paywalls/pro/app/hero.png")], superwallDir, pro))
      .toBe(`This file is hosted as an asset, so it has to live in an assets/ directory:
  paywalls/pro/app/hero.png
Move it to assets/ (shared by every surface) or paywalls/pro/assets/.`);
  });

  it("names several strays in the plural", () => {
    expect(
      misplacedAssets(
        [
          asset("/app/superwall/paywalls/pro/app/hero.png"),
          asset("/app/superwall/components/bg.png"),
        ],
        superwallDir,
        pro,
      ),
    ).toBe(`These files are hosted as assets, so they have to live in an assets/ directory:
  paywalls/pro/app/hero.png
  components/bg.png
Move them to assets/ (shared by every surface) or paywalls/pro/assets/.`);
  });
});

describe("injectRouteAssets", () => {
  it("leaves a document alone when nothing is hosted", () => {
    expect(injectRouteAssets("<html></html>", {})).toBe("<html></html>");
  });

  it("places the route map before </body>, escaping angle brackets", () => {
    const html = injectRouteAssets("<html><body><div></div></body></html>", {
      index: [{ url: "https://cdn/x</script>.png", as: "image" }],
    });
    expect(html).toContain('<script type="application/json" id="sw-route-assets">');
    expect(html).toContain("\\u003c/script>.png");
    expect(html.indexOf("sw-route-assets")).toBeLessThan(html.indexOf("</body>"));
  });

  it("appends the map when there is no body", () => {
    expect(injectRouteAssets("<div></div>", { "*": [{ url: "u", as: "font" }] })).toMatch(
      /^<div><\/div><script/,
    );
  });
});

type Bundle = Parameters<
  Extract<ReturnType<typeof collectAssets>["generateBundle"], (...args: never[]) => unknown>
>[1];

const runCollect = (assetBaseUrl: string | undefined, graph: Record<string, string[]>) => {
  const root = "/app/superwall/.superwall/entries/paywall/pro";
  const pro = surface("/app/superwall/paywalls/pro");
  let collected: CollectedAssets | undefined;
  const plugin = collectAssets(root, "/app/superwall", pro, assetBaseUrl, (value) => {
    collected = value;
  });
  const bundle: Bundle = {
    "hero.png": {
      type: "asset",
      fileName: "hero.png",
      source: new Uint8Array([1, 2, 3]),
      originalFileNames: ["../../../../assets/hero.png"],
      name: undefined,
      names: [],
      originalFileName: null,
      needsCodeReference: false,
    },
    "clip.mp4": {
      type: "asset",
      fileName: "clip.mp4",
      source: "video-bytes",
      originalFileNames: [],
      name: undefined,
      names: [],
      originalFileName: null,
      needsCodeReference: false,
    },
    "data.json": {
      type: "asset",
      fileName: "data.json",
      source: "{}",
      originalFileNames: ["../../../../paywalls/pro/assets/data.json"],
      name: undefined,
      names: [],
      originalFileName: null,
      needsCodeReference: false,
    },
  };
  const context = {
    getModuleInfo: (id: string) => {
      const imported = graph[id];
      return imported === undefined
        ? null
        : { importedIds: imported, dynamicallyImportedIds: [] as string[] };
    },
    getModuleIds: () => Object.keys(graph)[Symbol.iterator](),
  };
  const generate = plugin.generateBundle;
  if (typeof generate !== "function") throw new Error("plugin has no generateBundle");
  Reflect.apply(generate, context, [{}, bundle, false]);
  if (!collected) throw new Error("plugin never reported");
  return collected;
};

describe("collectAssets", () => {
  const index = "/app/superwall/paywalls/pro/app/index.tsx";
  const plans = "/app/superwall/paywalls/pro/app/plans.tsx";

  it("attributes reachable assets to their routes and the rest to every route", () => {
    const collected = runCollect("https://cdn", {
      [index]: [
        "/app/superwall/assets/hero.png?used",
        "/app/superwall/paywalls/pro/assets/data.json",
      ],
      [plans]: [index],
    });

    expect(collected.assets.map((one) => [one.fileName, one.mime, one.path])).toEqual([
      ["hero.png", "image/png", "/app/superwall/assets/hero.png"],
      ["clip.mp4", "video/mp4", "clip.mp4"],
      ["data.json", "application/octet-stream", "/app/superwall/paywalls/pro/assets/data.json"],
    ]);
    expect(collected.routes).toEqual({
      index: [{ url: "https://cdn/hero.png", as: "image" }],
      plans: [{ url: "https://cdn/hero.png", as: "image" }],
      "*": [{ url: "https://cdn/clip.mp4", as: "video" }],
    });
    expect(collected.misplaced).toBeUndefined();
  });

  it("builds no preload map when nothing is hosted", () => {
    const collected = runCollect(undefined, { [index]: ["/app/superwall/assets/hero.png"] });
    expect(collected.routes).toEqual({});
    expect(collected.misplaced).toBeUndefined();
  });
});

describe("assetFileName", () => {
  it("content-addresses an asset, and falls back to rollup's hash without content", () => {
    expect(assetFileName({ source: "hero" })).toBe(`${sha256("hero")}[extname]`);
    expect(assetFileName({ source: new Uint8Array([1, 2]) })).toBe(
      `${sha256(new Uint8Array([1, 2]))}[extname]`,
    );
    expect(assetFileName({})).toBe("[hash][extname]");
  });
});
