import { describe, expect, it } from "vitest";
import { entrySource } from "../../src/build/entry";
import type { DiscoveredSurface, Project } from "../../src/discover";

const superwallDir = "/app/superwall";
const entryDir = `${superwallDir}/.superwall/entries/paywall/pro`;

const project: Project = {
  root: "/app",
  superwallDir,
  sharedMessages: [{ locale: "en", file: `${superwallDir}/messages/en.ts` }],
  surfaces: [],
  diagnostics: [],
};

const surface = (extra: Partial<DiscoveredSurface> = {}): DiscoveredSurface => ({
  kind: "paywall",
  id: "pro",
  dir: `${superwallDir}/paywalls/pro`,
  configFile: `${superwallDir}/paywalls/pro/config.ts`,
  routes: [{ name: "index", file: `${superwallDir}/paywalls/pro/app/index.tsx` }],
  messages: [{ locale: "de", file: `${superwallDir}/paywalls/pro/messages/de.ts` }],
  diagnostics: [],
  ...extra,
});

describe("entrySource", () => {
  it("imports routes, catalogs and the definition relative to the entry", () => {
    const source = entrySource({ entryDir, project, surface: surface(), config: {} });
    expect(source).toContain('import * as Route0 from "../../../../paywalls/pro/app/index.tsx";');
    expect(source).toContain('import definition from "../../../../paywalls/pro/config.ts";');
    expect(source).toContain('import messages0 from "../../../../messages/en.ts";');
    expect(source).toContain('import messages1 from "../../../../paywalls/pro/messages/de.ts";');
    expect(source).toContain('["en", messages0], ["de", messages1]');
    expect(source).toContain('const routes = {"index": Route0};');
    expect(source).toContain(
      '<PaywallRouter routes={routes} transition={definition?.transition} queryState={definition?.queryState} navigationId={"pro"} />',
    );
    expect(source).not.toContain("SuperwallCheckout");
    expect(source).not.toContain("products:");
  });

  it("wires the layout, the checkout sheet and resolved products when asked", () => {
    const source = entrySource({
      entryDir,
      project,
      surface: surface({ layoutFile: `${superwallDir}/paywalls/pro/app/layout.tsx` }),
      config: { checkout: "sheet" },
      products: { primary: "pro_year" },
    });
    expect(source).toContain('import * as layout from "../../../../paywalls/pro/app/layout.tsx";');
    expect(source).toContain("const { default: Layout, entry } = { ...layout };");
    expect(source).toContain('import { SuperwallCheckout } from "superwall/checkout";');
    expect(source).toContain("<SuperwallCheckout />");
    expect(source).toContain('products: {"primary":"pro_year"},');
    expect(source).toContain("<PaywallRouter routes={routes} Layout={Layout} entry={entry}");
  });

  it("hands the provider the inline products a platform build baked, and only when there are some", () => {
    const baked = entrySource({
      entryDir,
      project,
      surface: surface(),
      config: {},
      products: { card14: "live:price_1:14days-free" },
      inlineProducts: { card14: { price: "$59.99" } },
    });
    expect(baked).toContain(
      '<SuperwallProvider config={config} inlineProducts={{"card14":{"price":"$59.99"}}}>',
    );

    const none = entrySource({
      entryDir,
      project,
      surface: surface(),
      config: {},
      products: { annual: "pro_year" },
      inlineProducts: {},
    });
    expect(none).toContain("<SuperwallProvider config={config}>");
  });

  it("mounts checkout and the teleport screens for a paywall that teleports", () => {
    const source = entrySource({
      entryDir,
      project,
      surface: surface(),
      config: { teleport: { route: "checkout" } },
    });
    expect(source).toContain(
      'import { SuperwallCheckout, TeleportScreen } from "superwall/checkout";',
    );
    expect(source).toContain("<SuperwallCheckout />");
    expect(source).toContain("<TeleportScreen />");
  });

  it("prefixes ./ for a file that sits beside the entry", () => {
    const source = entrySource({
      entryDir,
      project,
      surface: surface({ routes: [{ name: "index", file: `${entryDir}/generated.tsx` }] }),
      config: {},
    });
    expect(source).toContain('import * as Route0 from "./generated.tsx";');
  });
});
