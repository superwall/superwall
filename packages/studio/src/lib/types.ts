export type VariableSpec =
  | { type: "string"; default: string; label?: string }
  | { type: "boolean"; default: boolean; label?: string }
  | { type: "number"; default: number; min?: number; max?: number; label?: string }
  | { type: "enum"; values: readonly string[]; default: string; label?: string };

export type VariablesSchema = Record<string, VariableSpec>;

export type StudioSurfaceKind = "paywall" | "funnel";

export type StudioSurface = {
  kind: StudioSurfaceKind;
  id: string;
  pageRoutes: string[];
  locales: string[];
  variables?: VariablesSchema;
  paywallId?: string;
};

export type PreviewOverrides = {
  theme?: "light" | "dark";
  locale?: string;
  variables?: Record<string, unknown>;
  device?: Record<string, unknown>;
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
};

export type StudioSource = {
  title: string;
  surfaces: StudioSurface[];
  diagnostics?: string[];
  previewUrl: PreviewUrlBuilder;
  capabilities?: { actions: boolean };
};
