import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importDefault, loadSurfaceConfig } from "../../src/config/load";
import type { DiscoveredSurface, Project } from "../../src/discover";
import { readLock } from "../../src/lock";

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

const surface = (dir: string, configFile?: string): DiscoveredSurface => ({
  kind: "paywall",
  id: "plus-upgrade",
  dir,
  configFile,
  pages: [],
  messages: [],
});

const project = (root: string, appConfigFile?: string): Project => ({
  root,
  superwallDir: root,
  appConfigFile,
  surfaces: [],
  sharedMessages: [],
  diagnostics: [],
});

/**
 * The real loader needs tsx (project configs are TypeScript), which vitest's
 * pipeline is not — `superwall push` and `superwall dev` exercise it on every
 * run. Its failure contract is testable here; the merge logic below goes
 * through the injectable seam.
 */
const jsonLoader = async <T>(file: string | undefined): Promise<T | undefined> =>
  file ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : undefined;

describe("importDefault", () => {
  it("returns undefined without a file and for unreadable modules", async () => {
    expect(await importDefault(undefined)).toBeUndefined();
    const dir = scaffold({ "broken.mjs": "this is not javascript {{{" });
    expect(await importDefault(path.join(dir, "broken.mjs"))).toBeUndefined();
  });
});

describe("loadSurfaceConfig", () => {
  it("merges the surface definition over app defaults", async () => {
    const dir = scaffold({
      "config.json": JSON.stringify({
        defaults: { featureGating: "gated", scrollEnabled: false },
      }),
      "paywall.json": JSON.stringify({ featureGating: "nonGated" }),
    });

    const loaded = await loadSurfaceConfig(
      project(dir, path.join(dir, "config.json")),
      surface(dir, path.join(dir, "paywall.json")),
      jsonLoader,
    );

    expect(loaded.appConfig).toMatchObject({ defaults: { featureGating: "gated" } });
    // Surface wins; untouched defaults survive.
    expect(loaded.config.featureGating).toBe("nonGated");
    expect(loaded.config.scrollEnabled).toBe(false);
  });

  it("yields an empty config when a project declares nothing", async () => {
    const dir = scaffold({});
    const loaded = await loadSurfaceConfig(project(dir), surface(dir), jsonLoader);
    expect(loaded.definition).toBeUndefined();
    expect(loaded.appConfig).toBeUndefined();
    expect(loaded.config).toMatchObject({ presentation: undefined });
  });
});

describe("readLock", () => {
  it("reads the CLI-written bindings", () => {
    const dir = scaffold({
      "superwall.lock": JSON.stringify({
        version: 1,
        applicationId: "7",
        paywalls: { "plus-upgrade": { paywallId: "208540" } },
        funnels: {},
      }),
    });
    const lock = readLock(dir);
    expect(lock.applicationId).toBe("7");
    expect(lock.paywalls["plus-upgrade"]).toEqual({ paywallId: "208540" });
  });

  it("treats a missing, corrupt, or future-version lock as unbound", () => {
    expect(readLock(scaffold({}))).toEqual({ version: 1, paywalls: {}, funnels: {} });
    expect(readLock(scaffold({ "superwall.lock": "{{{" }))).toEqual({
      version: 1,
      paywalls: {},
      funnels: {},
    });
    expect(readLock(scaffold({ "superwall.lock": '{"version":2}' }))).toEqual({
      version: 1,
      paywalls: {},
      funnels: {},
    });
  });
});
