/**
 * Answers live outside React because a later page reads them after the one
 * that collected them has unmounted, and the router carries no state. Each key
 * is the attribute sent to Superwall with `setUserAttributes` the moment it is
 * answered; values are stable kebab-case so audiences built on them hold.
 */
export const answers: {
  sleep_struggle?: "racing" | "waking" | "schedule" | "noise";
  bad_nights?: "one" | "few" | "most" | "every";
  tried_before?: "nothing" | "melatonin" | "apps" | "routine";
} = {};
