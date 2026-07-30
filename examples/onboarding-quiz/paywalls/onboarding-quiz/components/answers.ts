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
  lose: { title: "Lean", blurb: "Steady deficit, plenty of walking, three lifts a week." },
  build: { title: "Strong", blurb: "Progressive overload, four lifts a week, eat for it." },
  endure: { title: "Distance", blurb: "Easy miles, one hard session, one long run." },
};
