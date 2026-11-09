import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AppScheme,
  Samples,
  StudioActionName,
  StudioActionProgress,
  StudioActionResult,
  StudioScreenshot,
  StudioStatus,
} from "@superwall/studio/contract";

interface FrameworkRoute {
  name: string;
  file: string;
}

export interface FrameworkSurface {
  kind: "paywall" | "funnel";
  id: string;
  dir: string;
  configFile: string;
  routes: FrameworkRoute[];
  diagnostics?: string[];
}

type ProjectMarker = "package.json";

export interface FrameworkProject {
  root: string;
  superwallDir: string;
  marker?: ProjectMarker;
  packageName?: string;
  surfaces: FrameworkSurface[];
  diagnostics: string[];
}

interface BuiltSnapshotAsset {
  fileName: string;
  sha256: string;
  bytes: number;
  mime: string;
  path: string;
}

type PaywallPresentationStyle =
  | { type: "FULLSCREEN" | "MODAL" | "PUSH" | "NO_ANIMATION" }
  | { type: "DRAWER"; height: number; corner_radius: number }
  | { type: "POPUP"; width: number; height: number; corner_radius: number };

export interface PaywallSettings {
  presentation_style: PaywallPresentationStyle;
  feature_gating: "gated" | "non_gated";
  on_device_cache: boolean;
  scroll_enabled: boolean;
  game_controller_enabled: boolean;
  introductory_offer_eligibility?: "automatic" | "always_eligible" | "always_ineligible";
  web_checkout_destination?: "EXTERNAL" | "PAYWALL_EMBEDDED" | "PAYWALL_APPLE_PAY";
  background_color_hex?: string;
  dark_background_color_hex?: string;
}

export interface BuiltSnapshot {
  name: string;
  products?: Record<string, string>;
  billingPlans?: Record<string, "monthly" | "upFront">;
  checkout?: string;
  background?: { light: string; dark?: string };
  settings?: PaywallSettings;
  locales?: string[];
  snapshotId: string;
  html: string;
  bytes: number;
  htmlFile: string;
  assets?: BuiltSnapshotAsset[];
  assetBytes?: number;
  externalSources?: string[];
}

export interface BuildOptions {
  assetBaseUrl?: string;
  platform?: string;
  catalogue?: Record<string, Record<string, unknown>>;
}

interface PreviewServerHandle {
  resolvedUrls?: { local: string[]; network: string[] } | null;
}

export type {
  AppScheme,
  Samples,
  StudioActionName,
  StudioActionProgress,
  StudioActionResult,
  StudioScreenshot,
  StudioStatus,
} from "@superwall/studio/contract";

export interface StudioActions {
  appScheme?(): Promise<AppScheme>;
  screenshots?(surface: FrameworkSurface): Promise<StudioScreenshot[] | undefined>;
  screenshot?(surface: FrameworkSurface): Promise<string | undefined>;
  samples?(): Promise<Samples>;
  run(
    action: StudioActionName,
    surface: FrameworkSurface,
    onProgress?: StudioActionProgress,
    options?: { version?: number },
  ): Promise<StudioActionResult>;
  status(surface: FrameworkSurface): Promise<StudioStatus>;
}

export interface Framework {
  discoverProject(root: string): FrameworkProject;
  buildSnapshot(
    project: FrameworkProject,
    surface: FrameworkSurface,
    options?: BuildOptions,
  ): Promise<BuiltSnapshot>;
  startPreviewServer(
    roots: string | readonly string[],
    options: { port: number; host?: string; platformStylesheet?: string; studio?: StudioActions },
  ): Promise<PreviewServerHandle>;
  studioProject?(root: string): Promise<{
    surfaces: {
      kind?: string;
      id?: string;
      products: Record<string, string>;
      productIds?: Record<string, string[]>;
      platforms?: string[];
    }[];
  }>;
}

export class FrameworkNotFoundError extends Error {
  constructor(dir: string) {
    super(
      `No superwall framework found from ${dir}.\n` +
        "Install it in the project (`npm i superwall` / `bun add superwall`) " +
        "and make sure you run this inside a project with a superwall/ directory.",
    );
  }
}

/**
 * A directory the framework's tools can't work under. tsx, which loads TypeScript, cuts a file's
 * path at `?`, so `src/build/index.ts` under `Good Deal? AI/` is compiled as JavaScript and fails
 * on its first type. Vite reads both `?` and `#` in a path as the start of a URL query or fragment,
 * so it can't build or preview a project below either. A symlink doesn't help: both resolve it to
 * the real path. Neither is ours to change, so the CLI says so before they fail.
 */
export class UnsupportedProjectPathError extends Error {
  constructor(
    readonly dir: string,
    readonly segment: string,
  ) {
    const chars = ["?", "#"].filter((char) => segment.includes(char)).map((char) => `\`${char}\``);
    super(
      `superwall can't work in ${dir}: the directory \`${segment}\` has ${chars.join(" and ")} in its name, ` +
        "which the build tools read as part of a URL, so the project's files can't be loaded.\n" +
        `Rename \`${segment}\`, or move the project to a path without \`?\` or \`#\`. ` +
        "A symlink doesn't help: the tools resolve it to the real path.",
    );
  }
}

const realpath = (dir: string): string => {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
};

/** Throws when a directory of `dir`'s real path has one of `chars` in its name. */
export function assertWorkablePath(dir: string, chars: "?" | "?#" = "?#"): void {
  const real = realpath(dir);
  const segment = real.split(sep).find((part) => [...chars].some((char) => part.includes(char)));
  if (segment !== undefined) throw new UnsupportedProjectPathError(real, segment);
}

async function importSubpath(packageDir: string, subpath: string): Promise<Record<string, unknown>> {
  const require = createRequire(join(packageDir, "package.json"));
  return import(pathToFileURL(require.resolve(subpath)).href);
}

function fn<T>(mod: Record<string, unknown>, name: string, subpath: string): T {
  const candidate = mod[name];
  if (typeof candidate !== "function") {
    throw new Error(
      `This project's superwall version does not export ${name} from ${subpath} — ` +
        "update the project's superwall dependency.",
    );
  }
  return candidate as T;
}

export function resolveFrameworkDir(cwd: string): string {
  for (const anchor of [join(cwd, "superwall", "package.json"), join(cwd, "package.json")]) {
    try {
      return join(createRequire(anchor).resolve("superwall/package.json"), "..");
    } catch {
      continue;
    }
  }
  throw new FrameworkNotFoundError(cwd);
}

export function frameworkVersion(cwd: string): string {
  try {
    const { version } = JSON.parse(
      readFileSync(join(resolveFrameworkDir(cwd), "package.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof version === "string" && version !== "") return version;
  } catch {
    return "unknown";
  }
  return "unknown";
}

export async function resolveFramework(cwd: string): Promise<Framework> {
  // tsx loads the framework and every surface's config.ts: neither may sit below a `?`.
  assertWorkablePath(cwd, "?");
  const dir = resolveFrameworkDir(cwd);
  assertWorkablePath(dir, "?");

  const [discover, build, preview] = await Promise.all([
    importSubpath(dir, "superwall/discover"),
    importSubpath(dir, "superwall/build"),
    importSubpath(dir, "superwall/preview"),
  ]);

  const studioProject =
    typeof preview.buildStudioProject === "function"
      ? (preview.buildStudioProject as Framework["studioProject"])
      : undefined;

  const buildSnapshot = fn<Framework["buildSnapshot"]>(build, "buildSnapshot", "superwall/build");
  const startPreviewServer = fn<Framework["startPreviewServer"]>(
    preview,
    "startPreviewServer",
    "superwall/preview",
  );
  // Vite builds and previews: no project root below a `?` or a `#`.
  return {
    discoverProject: fn(discover, "discoverProject", "superwall/discover"),
    buildSnapshot: async (project, surface, options) => {
      assertWorkablePath(project.root);
      return buildSnapshot(project, surface, options);
    },
    startPreviewServer: async (roots, options) => {
      for (const root of typeof roots === "string" ? [roots] : roots) assertWorkablePath(root);
      return startPreviewServer(roots, options);
    },
    studioProject,
  };
}
