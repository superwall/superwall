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
  /**
   * Builds the URL a phone should open to see this surface on a real device.
   *
   * Only a hosted studio needs this: locally the studio builds a `superwall_dev`
   * link to its own server, but a hosted one has no server to point at and the
   * link has to carry a short-lived token, so the host mints it.
   */
  previewLink?: (surface: StudioSurface) => Promise<string>;
  compareHint?: string;
};

export const hasActions = (source: StudioSource): boolean => source.capabilities?.actions === true;
