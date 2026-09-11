import type { SampleDefaults } from "./variables";

export type {
  AppScheme,
  Samples,
  StudioActionName,
  StudioActionProgress,
  StudioActionResult,
  StudioStatus,
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
  paywallId?: string;
  paywallIdentifier?: string;
};

export type PreviewUrlBuilder = (surface: StudioSurface) => string;

export type CompareTarget = { type: "live" } | { type: "surface"; surface: StudioSurface };

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
