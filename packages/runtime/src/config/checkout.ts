/**
 * How a purchase completes on the web. Native hosts ignore it — they always
 * buy through the store.
 *
 * - `external` — leave for Superwall's hosted checkout page and come back.
 * - `sheet` — take payment in the paywall, in a sheet Superwall renders.
 * - `applePay` — go straight to Apple Pay, falling back to the sheet where
 *   Apple Pay is unavailable.
 *
 * The sheet's appearance is fixed and takes nothing from the paywall around
 * it. `sheet` and `applePay` carry Stripe's payment UI into the bundle;
 * `external` costs nothing. Read this before shipping either:
 * https://superwall.com/docs/web-checkout
 */
export type SuperwallCheckoutMode = "external" | "sheet" | "applePay";

/**
 * The mode alone, or the object form to steer prefetching: `prefetch` names
 * the Stripe product warmed on paywall open (default: the first Stripe
 * product), `false` disables automatic prefetch.
 */
export type SuperwallCheckoutConfig<TReference extends string = string> =
  | SuperwallCheckoutMode
  | { mode: SuperwallCheckoutMode; prefetch?: TReference | false };

export const checkoutModeOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): SuperwallCheckoutMode | undefined => (typeof checkout === "string" ? checkout : checkout?.mode);

export const checkoutPrefetchOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): string | false | undefined => (typeof checkout === "object" ? checkout.prefetch : undefined);
