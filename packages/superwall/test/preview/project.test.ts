import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PaywallDefinition } from "../../src/config";
import {
  SAMPLE_DEFAULTS,
  buildStudioProject,
  buildStudioProjects,
  type ConfigLoader,
} from "../../src/preview/project";

/**
 * The production loader evaluates config.ts under the tsx runtime the CLI
 * always runs in; vitest has no TS-capable native import, so payload
 * assembly is tested through the injectable loader (JSON-shaped configs).
 * The default loader's failure branch is covered by the broken-config case.
 */
const jsonLoader: ConfigLoader = (file) =>
  Promise.resolve(JSON.parse(fs.readFileSync(file, "utf8")) as PaywallDefinition);

const roots: string[] = [];

const scaffold = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-studio-data-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const targetPath = path.join(root, file);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
  }
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("buildStudioProject", () => {
  it("evaluates configs server-side into the studio payload", async () => {
    const root = scaffold({
      "superwall/messages/en.ts": "export default {}\n",
      "superwall/paywalls/plus-upgrade/app/layout.tsx": "export default () => null\n",
      "superwall/paywalls/plus-upgrade/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/plus-upgrade/app/offer.tsx": "export default () => null\n",
      "superwall/paywalls/plus-upgrade/messages/es.ts": "export default {}\n",
      "superwall/paywalls/plus-upgrade/config.ts": JSON.stringify({
        platforms: ["ios", "android"],
        variables: { plan: { type: "enum", values: ["go", "plus"], default: "plus" } },
        localization: { defaultLocale: "en", messages: { de: {} } },
      }),
      "superwall/superwall.lock": JSON.stringify({
        version: 1,
        apps: { ios: "7", android: "8" },
        paywalls: {
          "plus-upgrade": { ios: { paywallId: "208540" }, android: { paywallId: "208541" } },
        },
        funnels: {},
      }),
    });

    const payload = await buildStudioProject(root, jsonLoader);

    expect(payload.title).toBe(path.basename(root));
    expect(payload.surfaces).toHaveLength(1);
    const surface = payload.surfaces[0];
    expect(surface).toMatchObject({
      kind: "paywall",
      id: "plus-upgrade",
      routes: ["index", "offer"],
      platforms: ["ios", "android"],
      paywallId: "208540",
    });
    // Shared + local + config-declared locales, deduped and sorted.
    expect(surface.locales).toEqual(["de", "en", "es"]);
  });

  it("keeps a surface listed when its config.ts is broken", async () => {
    const root = scaffold({
      "superwall/paywalls/broken/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/broken/config.ts": "this is not typescript {{{\n",
    });

    const payload = await buildStudioProject(root);
    expect(payload.surfaces).toHaveLength(1);
    expect(payload.surfaces[0]).toMatchObject({ id: "broken" });
  });
});

describe("buildStudioProject products", () => {
  it("maps each reference to its product id, falling back to the reference itself", async () => {
    const root = scaffold({
      "superwall/paywalls/pro/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/pro/config.ts": JSON.stringify({
        products: {
          primary: "pro_3999_year",
          secondary: { productId: "pro_999_month" },
          placeholder: {},
        },
      }),
    });

    const payload = await buildStudioProject(root, jsonLoader);

    expect(payload.surfaces[0]?.products).toEqual({
      primary: "pro_3999_year",
      secondary: "pro_999_month",
      placeholder: "placeholder",
    });
  });
});

describe("buildStudioProjects", () => {
  it("serves a single project as itself, listed once, with the sample defaults", async () => {
    const root = scaffold({
      "superwall/paywalls/pro/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/pro/config.ts": JSON.stringify({}),
    });

    const payload = await buildStudioProjects([{ slug: "app", root }], jsonLoader);

    expect(payload.title).toBe(path.basename(root));
    expect(payload.projects).toEqual([{ slug: "app", title: path.basename(root) }]);
    expect(payload.samples).toBe(SAMPLE_DEFAULTS);
    expect(payload.surfaces.map((surface) => surface.id)).toEqual(["pro"]);
    expect(payload.surfaces[0]).not.toHaveProperty("project");
  });

  it("merges several projects, tagging every surface with its project slug", async () => {
    const alpha = scaffold({
      "superwall/paywalls/pro/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/pro/config.ts": JSON.stringify({}),
      "superwall/paywalls/pro/app/helper.ts": "export const x = 1\n",
    });
    const beta = scaffold({
      "superwall/funnels/onboarding/app/index.tsx": "export default () => null\n",
      "superwall/funnels/onboarding/config.ts": JSON.stringify({}),
    });

    const payload = await buildStudioProjects(
      [
        { slug: "alpha", root: alpha },
        { slug: "beta", root: beta },
      ],
      jsonLoader,
    );

    expect(payload.title).toBe("2 projects");
    expect(payload.projects).toEqual([
      { slug: "alpha", title: path.basename(alpha) },
      { slug: "beta", title: path.basename(beta) },
    ]);
    expect(payload.samples).toBe(SAMPLE_DEFAULTS);
    expect(payload.surfaces.map((surface) => [surface.project, surface.kind, surface.id])).toEqual([
      ["alpha", "paywall", "pro"],
      ["beta", "funnel", "onboarding"],
    ]);
    expect(payload.diagnostics).toHaveLength(1);
    expect(payload.diagnostics[0]).toContain("helper.ts");
  });

  it("reports an empty studio when no project is served", async () => {
    const payload = await buildStudioProjects([], jsonLoader);
    expect(payload).toMatchObject({
      title: "0 projects",
      projects: [],
      surfaces: [],
      diagnostics: [],
    });
  });
});

describe("per-platform products in the studio payload", () => {
  it("resolves ids for the surface's first platform and lists every id for typing", async () => {
    const root = scaffold({
      "superwall/paywalls/stores/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/stores/config.ts": JSON.stringify({
        platforms: ["android", "ios"],
        products: {
          monthly: "pro_month",
          annual: { ios: "pro_year", android: "pro_year_play" },
          web: { web: "live:price_1:trial" },
        },
      }),
    });

    const payload = await buildStudioProject(root, jsonLoader);
    const surface = payload.surfaces[0];
    expect(surface?.products).toEqual({
      monthly: "pro_month",
      annual: "pro_year_play",
      web: "live:price_1:trial",
    });
    expect(surface?.productIds).toEqual({
      monthly: ["pro_month"],
      annual: ["pro_year", "pro_year_play"],
      web: ["live:price_1:trial"],
    });
  });

  it("uses the lock's first platform when the config names none", async () => {
    const root = scaffold({
      "superwall/paywalls/stores/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/stores/config.ts": JSON.stringify({
        products: { annual: { ios: "pro_year", android: "pro_year_play" } },
      }),
      "superwall/superwall.lock": JSON.stringify({
        version: 1,
        apps: { android: "8" },
        paywalls: {},
        funnels: {},
      }),
    });

    const payload = await buildStudioProject(root, jsonLoader);
    expect(payload.surfaces[0]?.products).toEqual({ annual: "pro_year_play" });
  });

  it("tells the studio the platforms the lock binds when the config names none", async () => {
    const root = scaffold({
      "superwall/paywalls/site/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/site/config.ts": JSON.stringify({ products: { annual: "pro_year" } }),
      "superwall/superwall.lock": JSON.stringify({
        version: 1,
        apps: { web: "52518" },
        paywalls: {},
        funnels: {},
      }),
    });

    const payload = await buildStudioProject(root, jsonLoader);
    expect(payload.surfaces[0]?.platforms).toEqual(["web"]);

    const unbound = scaffold({
      "superwall/paywalls/site/app/index.tsx": "export default () => null\n",
      "superwall/paywalls/site/config.ts": JSON.stringify({ products: { annual: "pro_year" } }),
    });
    expect((await buildStudioProject(unbound, jsonLoader)).surfaces[0]?.platforms).toBeUndefined();
  });
});
