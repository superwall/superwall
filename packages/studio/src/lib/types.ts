import type { StudioActionName } from "./contract";

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

export type SampleDefaults = {
  device: Record<string, unknown>;
  user: Record<string, unknown>;
  params: Record<string, unknown>;
};

export type VariableOverrides = {
  device?: Record<string, unknown>;
  user?: Record<string, unknown>;
  params?: Record<string, unknown>;
  products?: Record<string, Record<string, unknown>>;
  introductoryOfferEligible?: boolean;
};

export type PreviewUrlBuilder = (surface: StudioSurface) => string;

export type CompareTarget = { type: "live" } | { type: "surface"; surface: StudioSurface };

export type StudioStepState = "pending" | "active" | "done" | "failed";

export type StudioActionStep = "link" | "build" | "assets" | "push" | "source" | "promote";

export const ACTION_STEPS: Record<StudioActionName, StudioActionStep[]> = {
  push: ["link", "build", "assets", "push", "source"],
  publish: ["link", "build", "assets", "push", "source", "promote"],
  promote: ["link", "promote"],
};

export const STEP_LABELS: Record<StudioActionStep, string> = {
  link: "Find paywall",
  build: "Build snapshot",
  assets: "Sync assets",
  push: "Push version",
  source: "Push source",
  promote: "Promote to live",
};

export type StudioSource = {
  scheme?: string;
  title: string;
  surfaces: StudioSurface[];
  diagnostics?: string[];
  samples?: SampleDefaults;
  previewUrl: PreviewUrlBuilder;
  standaloneUrl?: PreviewUrlBuilder;
  capabilities?: { actions: boolean };
  compareHint?: string;
};
