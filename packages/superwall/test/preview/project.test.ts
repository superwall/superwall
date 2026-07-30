import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PaywallDefinition } from "../../src/config";
import { buildStudioProject, type ConfigLoader } from "../../src/preview/project";

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
        variables: { plan: { type: "enum", values: ["go", "plus"], default: "plus" } },
        localization: { defaultLocale: "en", messages: { de: {} } },
      }),
      "superwall/superwall.lock": JSON.stringify({
        version: 1,
        paywalls: { "plus-upgrade": { paywallId: "208540" } },
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
