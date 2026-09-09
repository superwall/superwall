import type { StudioActionName } from "./contract";

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
