import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface FrameworkRoute {
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

export type ProjectMarker = "package.json";

export interface FrameworkProject {
  root: string;
  superwallDir: string;
  marker?: ProjectMarker;
  packageName?: string;
  surfaces: FrameworkSurface[];
  diagnostics: string[];
}

export interface BuiltSnapshotAsset {
  fileName: string;
  sha256: string;
  bytes: number;
  mime: string;
  path: string;
}

export type PaywallPresentationStyle =
  | { type: "FULLSCREEN" | "MODAL" | "PUSH" | "NO_ANIMATION" }
  | { type: "DRAWER"; height: number; corner_radius: number }
  | { type: "POPUP"; width: number; height: number; corner_radius: number };

export interface PaywallSettings {
  presentation_style: PaywallPresentationStyle;
  feature_gating: "gated" | "non_gated";
  on_device_cache: boolean;
  scroll_enabled: boolean;
  game_controller_enabled: boolean;
  introductory_offer_eligibility: "automatic" | "always_eligible" | "always_ineligible";
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
}

export interface PreviewServerHandle {
  resolvedUrls?: { local: string[]; network: string[] } | null;
}

export type StudioActionName = "push" | "promote" | "publish";

export type StudioActionResult =
  | { ok: true; version: number; live: boolean }
  | { ok: false; error: string };

export interface StudioStatus {
  paywallId?: string;
  liveUrl?: string;
  active?: boolean;
  updatedAt?: string;
  unreachable?: string;
}

export type StudioActionProgress = (step: string, state: "start" | "done") => void;

export interface Samples {
  device?: Record<string, unknown>;
  user?: Record<string, unknown>;
  products?: Record<string, Record<string, unknown>>;
  live?: { device: boolean; user: boolean };
  unreachable?: string;
}

export interface AppScheme {
  scheme?: string;
  source?: "dashboard" | "app";
  blocksLocalNetworking?: string;
}

export interface StudioActions {
  appScheme?(): Promise<AppScheme>;
  samples?(): Promise<Samples>;
  run(
    action: StudioActionName,
    surface: FrameworkSurface,
    onProgress?: StudioActionProgress,
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

async function importSubpath(packageDir: string, subpath: string): Promise<unknown> {
  const require = createRequire(join(packageDir, "package.json"));
  return import(pathToFileURL(require.resolve(subpath)).href);
}

function fn<T>(mod: unknown, name: string, subpath: string): T {
  if (typeof mod !== "object" || mod === null) {
    throw new Error(`superwall ${subpath} did not load as a module`);
  }
  const candidate = (mod as Record<string, unknown>)[name];
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
    const parsed: unknown = JSON.parse(
      readFileSync(join(resolveFrameworkDir(cwd), "package.json"), "utf8"),
    );
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as Record<string, unknown>).version;
      if (typeof version === "string" && version !== "") return version;
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

export async function loadFramework(cwd: string): Promise<Framework> {
  const dir = resolveFrameworkDir(cwd);

  const [discover, build, preview] = await Promise.all([
    importSubpath(dir, "superwall/discover"),
    importSubpath(dir, "superwall/build"),
    importSubpath(dir, "superwall/preview"),
  ]);

  const studioProject =
    typeof preview === "object" &&
    preview !== null &&
    typeof (preview as Record<string, unknown>).buildStudioProject === "function"
      ? ((preview as Record<string, unknown>).buildStudioProject as Framework["studioProject"])
      : undefined;

  return {
    discoverProject: fn(discover, "discoverProject", "superwall/discover"),
    buildSnapshot: fn(build, "buildSnapshot", "superwall/build"),
    startPreviewServer: fn(preview, "startPreviewServer", "superwall/preview"),
    studioProject,
  };
}
