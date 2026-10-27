import type { PostPurchaseBehavior } from "../types";

/**
 * Whether a completion under this behavior binds the entitlement to the
 * shopper server-side. `complete-webapp` refuses the others; an unknown
 * behavior means a session from before the field existed, so call rather
 * than drop one — the same rule paywall.js applies.
 */
export const bindsEntitlement = (behavior: PostPurchaseBehavior | undefined): boolean =>
  behavior === undefined || behavior === "GRANT_ACCESS" || behavior === "REDIRECT";
