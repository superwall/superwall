export type Goal = "lose" | "build" | "endure";

export type Level = "new" | "returning" | "regular";

export type Time = "15" | "30" | "45";

/**
 * Answers live outside React because a later screen reads them after the one
 * that collected them has unmounted. A store or a context would do the same
 * job — the point is that the router carries no state of its own.
 */
export const answers: { goal?: Goal; level?: Level; time?: Time } = {};

export const PLAN: Record<Goal, { title: string; blurb: string }> = {
  lose: { title: "plan.lose.title", blurb: "plan.lose.blurb" },
  build: { title: "plan.build.title", blurb: "plan.build.blurb" },
  endure: { title: "plan.endure.title", blurb: "plan.endure.blurb" },
};
