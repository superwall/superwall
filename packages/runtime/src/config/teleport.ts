import type { SuperwallIntroductoryOfferEligibility } from "./index";

/**
 * How teleport behaves: from a route on, a flow shown in an iOS app
 * continues on the web. `router.push(route, { teleport: true })`, a push to
 * `route`, or buying a Stripe product opens the route in the shopper's
 * browser on your project's web paywall domain, with the flow's
 * `useQueryState` values carried along; the shopper pays there with Stripe
 * and is sent back to the app, which is credited automatically. Needs
 * SuperwallKit 4.18.0 or later; on an older SDK the route opens in the app as
 * usual and a Stripe purchase goes to the hosted checkout page.
 */
export type SuperwallTeleportOptions<
  TStripeReference extends string = string,
  TStoreReference extends string = string,
  TRoute extends string = string,
> = {
  /**
   * The route the web half opens on by default: a push to it teleports, a
   * Stripe purchase teleports to it, and it is warmed when the paywall
   * opens. Default: none — a Stripe purchase teleports the route it was
   * tapped on, and only `router.push(route, { teleport: true })` teleports a
   * push.
   */
  route?: TRoute;
  /**
   * Show Superwall's teleport screen over the paywall while the shopper is in
   * the browser ("Finish in your browser", reopen, cancel). `false` keeps
   * the paywall as it is, for a flow that leaves midway, or for your own
   * screen drawn from `useTeleport()`. The purchase is watched either way.
   * Default: `true`.
   */
  overlay?: boolean;
  /**
   * A store product the teleport screen offers in place of a Stripe one,
   * keyed by the Stripe product's reference: "Continue In-App Instead" buys
   * it through the store. Shown only once the store has priced it.
   * Default: none.
   */
  fallbacks?: Partial<Record<TStripeReference, TStoreReference>>;
  /**
   * What the web page does once the purchase completes: `"confirmation"`
   * shows "You're all set" with a Return to App button, `"direct"` opens the
   * app at once. Either way the app is opened through its universal link,
   * falling back to its URL scheme when the link doesn't open it.
   * Default: `"confirmation"`.
   */
  completion?: "confirmation" | "direct";
  /**
   * Whether the web checkout offers the trial: `"automatic"` when the app's
   * store says the shopper is eligible, `"eligible"` always, `"ineligible"`
   * never. The App Store's trial history does not bind a Stripe purchase, so
   * this is separate from the paywall's own `introductoryOfferEligibility`.
   * Default: `"automatic"`.
   */
  introductoryOfferEligibility?: SuperwallIntroductoryOfferEligibility;
};

/**
 * Turn teleport on: `true` for every default, or the options to change.
 * Default: off.
 */
export type SuperwallTeleportConfig<
  TStripeReference extends string = string,
  TStoreReference extends string = string,
  TRoute extends string = string,
> = boolean | SuperwallTeleportOptions<TStripeReference, TStoreReference, TRoute>;

export type ResolvedTeleport = {
  route?: string;
  overlay: boolean;
  fallbacks: Partial<Record<string, string>>;
  completion: "confirmation" | "direct";
  introductoryOfferEligibility: SuperwallIntroductoryOfferEligibility;
};

export const teleportOf = (
  teleport: SuperwallTeleportConfig | undefined,
): ResolvedTeleport | undefined => {
  if (teleport === undefined || teleport === false) return undefined;
  const options = teleport === true ? {} : teleport;
  return {
    ...(options.route === undefined ? {} : { route: options.route }),
    overlay: options.overlay ?? true,
    fallbacks: options.fallbacks ?? {},
    completion: options.completion ?? "confirmation",
    introductoryOfferEligibility: options.introductoryOfferEligibility ?? "automatic",
  };
};
