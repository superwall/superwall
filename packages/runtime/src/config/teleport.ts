/**
 * Teleport: from one route on, a flow shown in an iOS app continues on the
 * web. Pushing to `route`, or buying a Stripe product, opens that route in
 * the shopper's browser on your project's web paywall domain, with the
 * flow's `useQueryState` values carried along; the shopper pays there with
 * Stripe and is sent back to the app, which is credited automatically.
 * Needs SuperwallKit 4.18.0 or later; on an older SDK the route opens in the
 * app as usual and a Stripe purchase goes to the hosted checkout page.
 */
export type SuperwallTeleportConfig = {
  /** The first route of the flow that runs on the web. Required. */
  route: string;
  /**
   * Show Superwall's waiting screen over the paywall while the shopper is in
   * the browser ("Finish in your browser", reopen, cancel). `false` keeps
   * the paywall as it is, for a flow that leaves midway; build your own with
   * `useTeleport()`. The purchase is watched either way. Default: `true`.
   */
  overlay?: boolean;
  /**
   * A store product to offer on the waiting screen in place of a Stripe one,
   * keyed by the Stripe product's reference: "Continue In-App Instead" buys
   * it natively. Shown only once the store has priced it. Default: none.
   */
  fallbacks?: Record<string, string>;
  /**
   * What the web page does once the purchase completes: `"screen"` shows
   * "You're all set" with a Return to App button, `"alert"` opens the app
   * through its URL scheme (iOS asks first), `"universal"` opens it through
   * its universal link. Default: `"screen"`.
   */
  returnStyle?: "screen" | "alert" | "universal";
  /**
   * How the web page returns to the app, from Return to App, from going back
   * on the first web route, and after a purchase: `"universal"` through the
   * universal link (falling back to the URL scheme when the app doesn't
   * open), `"scheme"` through the URL scheme. Default: `"universal"`.
   */
  appLink?: "universal" | "scheme";
  /**
   * Whether the web checkout offers the trial: `"matchApp"` when the app's
   * store says the shopper is eligible, `"always"` regardless.
   * Default: `"matchApp"`.
   */
  trialEligibility?: "matchApp" | "always";
};

export type ResolvedTeleport = Required<SuperwallTeleportConfig>;

export const teleportOf = (
  teleport: SuperwallTeleportConfig | undefined,
): ResolvedTeleport | undefined =>
  teleport === undefined
    ? undefined
    : {
        route: teleport.route,
        overlay: teleport.overlay ?? true,
        fallbacks: teleport.fallbacks ?? {},
        returnStyle: teleport.returnStyle ?? "screen",
        appLink: teleport.appLink ?? "universal",
        trialEligibility: teleport.trialEligibility ?? "matchApp",
      };
