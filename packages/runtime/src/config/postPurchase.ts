/**
 * What happens once a purchase completes. One vocabulary for both platforms;
 * each host reads the part it can act on:
 *
 * - `"dismiss"` — the default. Natively the SDK dismisses the paywall
 *   (`should_dismiss` on the purchase message; the app can still veto it
 *   with `SuperwallOptions.paywalls.automaticallyDismiss = false`). On the
 *   web the host does what the placement's delivery mode says: grant access
 *   and close inside a Web SDK overlay, redeem on a hosted page.
 * - `"stay"` — the paywall keeps control. Natively nothing is dismissed. On
 *   the web the host hands the completed purchase back to the paywall, which
 *   finishes it with `useCheckoutRedemption()` — a success page, a "Continue
 *   to app" button, whatever the flow needs.
 * - `"redeem"` — web only: send the shopper to the redemption page, which
 *   opens the app with their code. Natively the same as `"dismiss"`.
 * - `{ redirect: url }` — web only: send the shopper to that URL with their
 *   redemption code attached. Natively the same as `"dismiss"`.
 *
 * A `purchase()` call can override it per button.
 */
export type SuperwallPostPurchase = "dismiss" | "stay" | "redeem" | { redirect: string };

/**
 * Whether the native SDK should dismiss after the purchase — everything but
 * `"stay"`. Undefined when nothing was chosen, so the purchase message omits
 * the flag and the SDK keeps its own default, as before.
 */
export const dismissesOnPurchase = (
  postPurchase: SuperwallPostPurchase | undefined,
): boolean | undefined => (postPurchase === undefined ? undefined : postPurchase !== "stay");
