import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AppScheme,
  Samples,
  StudioActionName,
  StudioActionProgress,
  StudioActionResult,
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
  StudioStatus,
} from "@superwall/studio/contract";

export interface StudioActions {
  appScheme?(): Promise<AppScheme>;
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
  const dir = resolveFrameworkDir(cwd);

  const [discover, build, preview] = await Promise.all([
    importSubpath(dir, "superwall/discover"),
    importSubpath(dir, "superwall/build"),
    importSubpath(dir, "superwall/preview"),
  ]);

  const studioProject =
    typeof preview.buildStudioProject === "function"
      ? (preview.buildStudioProject as Framework["studioProject"])
      : undefined;

  return {
    discoverProject: fn(discover, "discoverProject", "superwall/discover"),
    buildSnapshot: fn(build, "buildSnapshot", "superwall/build"),
    startPreviewServer: fn(preview, "startPreviewServer", "superwall/preview"),
    studioProject,
  };
}
