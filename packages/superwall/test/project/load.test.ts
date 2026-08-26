import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importDefault, loadSurfaceConfig } from "../../src/config/load";
import type { DiscoveredSurface } from "../../src/discover";
import { boundPaywallIds, firstBinding, readLock } from "../../src/lock";

const dirs: string[] = [];

const scaffold = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-load-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
};

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const surface = (dir: string, configFile = path.join(dir, "missing.json")): DiscoveredSurface => ({
  kind: "paywall",
  id: "plus-upgrade",
  dir,
  configFile,
  routes: [],
  messages: [],
  diagnostics: [],
});

const jsonLoader = async <T>(file: string | undefined): Promise<T | undefined> => {
  if (!file) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
};

describe("importDefault", () => {
  it("returns undefined without a file and for unreadable modules", async () => {
    expect(await importDefault(undefined)).toBeUndefined();
    const dir = scaffold({ "broken.mjs": "this is not javascript {{{" });
    expect(await importDefault(path.join(dir, "broken.mjs"))).toBeUndefined();
  });
});

describe("loadSurfaceConfig", () => {
  it("is the surface definition, with nothing layered under it", async () => {
    const dir = scaffold({
      "paywall.json": JSON.stringify({ featureGating: "nonGated", scrollEnabled: false }),
    });

    const loaded = await loadSurfaceConfig(
      surface(dir, path.join(dir, "paywall.json")),
      jsonLoader,
    );

    expect(loaded.definition).toMatchObject({ featureGating: "nonGated" });
    expect(loaded.config.featureGating).toBe("nonGated");
    expect(loaded.config.scrollEnabled).toBe(false);
  });

  it("yields an empty config when the definition cannot be read", async () => {
    const dir = scaffold({});
    const loaded = await loadSurfaceConfig(surface(dir), jsonLoader);
    expect(loaded.definition).toBeUndefined();
    expect(loaded.config).toEqual({});
  });
});

describe("readLock", () => {
  it("reads the CLI-written bindings, one entry per app", () => {
    const dir = scaffold({
      "superwall.lock": JSON.stringify({
        version: 1,
        apps: { ios: "7", android: "8" },
        paywalls: {
          "plus-upgrade": {
            ios: { paywallId: "208540", snapshot: "abc" },
            android: { paywallId: "208541" },
          },
        },
        funnels: { onboarding: { ios: { paywallId: "300" } } },
      }),
    });
    const lock = readLock(dir);
    expect(lock.apps).toEqual({ ios: "7", android: "8" });
    expect(lock.paywalls["plus-upgrade"]).toEqual({
      ios: { paywallId: "208540", snapshot: "abc" },
      android: { paywallId: "208541" },
    });
    expect(lock.funnels.onboarding).toEqual({ ios: { paywallId: "300" } });
    expect(firstBinding(lock.paywalls["plus-upgrade"])?.paywallId).toBe("208540");
    expect(boundPaywallIds(lock.paywalls["plus-upgrade"])).toEqual(["208540", "208541"]);
  });

  it("drops malformed entries instead of failing the whole file", () => {
    const dir = scaffold({
      "superwall.lock": JSON.stringify({
        version: 1,
        apps: { ios: "7", broken: 3 },
        paywalls: {
          good: { ios: { paywallId: "1" }, bad: { paywallId: 2 } },
          empty: { ios: "nope" },
          scalar: "x",
        },
        funnels: "not an object",
      }),
    });
    const lock = readLock(dir);
    expect(lock.apps).toEqual({ ios: "7" });
    expect(lock.paywalls).toEqual({ good: { ios: { paywallId: "1" } } });
    expect(lock.funnels).toEqual({});
    expect(firstBinding(undefined)).toBeUndefined();
    expect(boundPaywallIds(undefined)).toEqual([]);
  });

  it("treats a missing, corrupt, or future-version lock as unbound", () => {
    const empty = { version: 1, apps: {}, paywalls: {}, funnels: {} };
    expect(readLock(scaffold({}))).toEqual(empty);
    expect(readLock(scaffold({ "superwall.lock": "{{{" }))).toEqual(empty);
    expect(readLock(scaffold({ "superwall.lock": '{"version":2}' }))).toEqual(empty);
    expect(readLock(scaffold({ "superwall.lock": "[]" }))).toEqual(empty);
  });
});
