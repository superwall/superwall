import type {
  StudioActionName,
  StudioActionProgress,
  StudioActionRequest,
  StudioActionResult,
  StudioStatus,
} from "./contract";
import type { StudioPresentation } from "./presentation";
import type { SampleDefaults } from "./variables";

export type { StudioPresentation } from "./presentation";

export type {
  AppScheme,
  Samples,
  StudioActionName,
  StudioActionProgress,
  StudioActionRequest,
  StudioActionResult,
  StudioResume,
  StudioStatus,
  StudioVersion,
} from "./contract";

export type StudioSurfaceKind = "paywall" | "funnel";

export type StudioSurface = {
  kind: StudioSurfaceKind;
  id: string;
  project?: string;
  label?: string;
  version?: number;
  products?: Record<string, string>;
  routes: string[];
  locales: string[];
  platforms?: string[];
  presentation?: StudioPresentation;
  paywallId?: string;
  paywallIdentifier?: string;
  origin?: StudioOrigin;
};

export type StudioScreenFramework =
  | "swiftui"
  | "uikit"
  | "compose"
  | "android-views"
  | "react-native"
  | "flutter";

export type StudioOrigin =
  | { paywallId: string; url: string }
  | { path: string; framework: StudioScreenFramework; screenshot?: string };

export const SCREEN_FRAMEWORK_LABEL: Record<StudioScreenFramework, string> = {
  swiftui: "SwiftUI",
  uikit: "UIKit",
  compose: "Jetpack Compose",
  "android-views": "Android Views",
  "react-native": "React Native",
  flutter: "Flutter",
};

export const isScreenOrigin = (
  origin: StudioOrigin,
): origin is Extract<StudioOrigin, { path: string }> => "path" in origin;

export const hasOriginal = (surface: StudioSurface): boolean =>
  surface.origin !== undefined &&
  (!isScreenOrigin(surface.origin) || surface.origin.screenshot !== undefined);

export type PreviewUrlBuilder = (surface: StudioSurface) => string;

/**
 * A build the host holds that is no pushed version: an agent chat's unsaved
 * paywall, say. The stage compares it beside the surface on it, and
 * `StudioSource.selectDraft` puts it on stage.
 */
export type StudioDraft = {
  /** Stable across newer builds of the same draft (its folder, say). */
  key: string;
  label: string;
  /** Its preview, hosted the way a pushed version's snapshot is. */
  url: string;
  hint?: string;
  presentation?: StudioPresentation;
  /** It is the surface on stage. */
  onStage?: boolean;
};

export type CompareTarget =
  | { type: "version"; version: number }
  | { type: "draft"; draft: StudioDraft }
  | { type: "surface"; surface: StudioSurface }
  | { type: "origin" };

export type StudioActions = {
  offered: readonly StudioActionName[];
  run(
    surface: StudioSurface,
    request: StudioActionRequest,
    onStep?: StudioActionProgress,
  ): Promise<StudioActionResult>;
  status(surface: StudioSurface): Promise<StudioStatus>;
  pick?(version: number): void;
};

export type StudioSource = {
  scheme?: string;
  networkOrigin?: string;
  title: string;
  surfaces: StudioSurface[];
  diagnostics?: string[];
  samples?: SampleDefaults;
  previewUrl: PreviewUrlBuilder;
  standaloneUrl?: PreviewUrlBuilder;
  actions?: StudioActions;
  previewLink?: (surface: StudioSurface) => Promise<string>;
  screenshotUrl?: (surface: StudioSurface) => Promise<string | undefined>;
  compareHint?: string;
  /** Unsaved builds, oldest first. The stage compares the newest beside the one on it. */
  drafts?: readonly StudioDraft[];
  /** Puts a draft on stage; the host moves the editor to it. */
  selectDraft?: (key: string) => void;
};

export const hasActions = (source: StudioSource): boolean => source.actions !== undefined;
