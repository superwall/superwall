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
};

export type SampleDefaults = {
  device: Record<string, unknown>;
  user: Record<string, unknown>;
  params: Record<string, unknown>;
};

export type PreviewOverrides = {
  theme?: "light" | "dark";
  locale?: string;
  device?: Record<string, unknown>;
  user?: Record<string, unknown>;
  params?: Record<string, unknown>;
  products?: Record<string, Record<string, unknown>>;
  trialEligible?: boolean;
};

export type PreviewUrlBuilder = (surface: StudioSurface, overrides: PreviewOverrides) => string;

export type StudioActionName = "push" | "promote" | "publish";

export type CompareTarget = { type: "live" } | { type: "surface"; surface: StudioSurface };

export type StudioActionResult =
  | { ok: true; version: number; live: boolean }
  | { ok: false; error: string };

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

export type StudioStatus = {
  paywallId?: string;
  liveUrl?: string;
  active?: boolean;
  updatedAt?: string;
  /** Why the live version couldn't be read, when it couldn't. */
  unreachable?: string;
};

export type StudioSource = {
  scheme?: string;
  title: string;
  surfaces: StudioSurface[];
  diagnostics?: string[];
  samples?: SampleDefaults;
  previewUrl: PreviewUrlBuilder;
  capabilities?: { actions: boolean };
  compareHint?: string;
};

export type Samples = {
  device?: Record<string, unknown>;
  user?: Record<string, unknown>;
  products?: Record<string, Record<string, unknown>>;
  live?: { device: boolean; user: boolean };
  /** Why samples couldn't be fetched, when they couldn't. */
  unreachable?: string;
};
