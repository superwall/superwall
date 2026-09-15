import type { StudioPresentation } from "./presentation";
import type { SampleDefaults } from "./variables";

export type { StudioPresentation } from "./presentation";

export type {
  AppScheme,
  Samples,
  StudioActionName,
  StudioActionProgress,
  StudioActionResult,
  StudioStatus,
  StudioVersion,
} from "./contract";

export type StudioSurfaceKind = "paywall" | "funnel";

export type StudioSurface = {
  kind: StudioSurfaceKind;
  id: string;
  project?: string;
  label?: string;
  products?: Record<string, string>;
  routes: string[];
  locales: string[];
  platforms?: string[];
  presentation?: StudioPresentation;
  paywallId?: string;
  paywallIdentifier?: string;
  origin?: StudioOrigin;
};

export type StudioOrigin = {
  paywallId: string;
  url: string;
};

export type PreviewUrlBuilder = (surface: StudioSurface) => string;

export type CompareTarget =
  | { type: "version"; version: number }
  | { type: "surface"; surface: StudioSurface }
  | { type: "origin" };

export type StudioSource = {
  scheme?: string;
  networkOrigin?: string;
  title: string;
  surfaces: StudioSurface[];
  diagnostics?: string[];
  samples?: SampleDefaults;
  previewUrl: PreviewUrlBuilder;
  standaloneUrl?: PreviewUrlBuilder;
  capabilities?: { actions: boolean };
  previewLink?: (surface: StudioSurface) => Promise<string>;
  screenshotUrl?: (surface: StudioSurface) => Promise<string | undefined>;
  compareHint?: string;
};

export const hasActions = (source: StudioSource): boolean => source.capabilities?.actions === true;
