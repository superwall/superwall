import type { StudioActionName } from "./contract";
import type { PromotionDirection } from "./promotion";

export type StudioStepState = "pending" | "active" | "done" | "failed";

export type StudioActionStep = "link" | "build" | "assets" | "push" | "source" | "promote";

export const ACTION_STEPS: Record<StudioActionName, StudioActionStep[]> = {
  push: ["link", "build", "assets", "push", "source"],
  publish: ["link", "build", "assets", "push", "source", "promote"],
  promote: ["link", "promote"],
};

const STEP_LABELS: Record<StudioActionStep, string> = {
  link: "Find paywall",
  build: "Build snapshot",
  assets: "Sync assets",
  push: "Push version",
  source: "Push source",
  promote: "Promote to live",
};

export const stepLabel = (
  step: StudioActionStep,
  direction: PromotionDirection,
  target: number | undefined,
): string =>
  step === "promote" && direction === "rollback" ? `Roll back to v${target}` : STEP_LABELS[step];
