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
 * The mode alone, or the object form to steer it:
 *
 * - `prefetch` names the Stripe product warmed on paywall open (default: the
 *   first Stripe product); `false` disables automatic prefetch.
 * - `managedPayments` overrides the account's Stripe managed-payments
 *   setting for this paywall: `true` forces it on, `false` forces it off.
 *   Omitted, the account setting applies.
 */
export type SuperwallCheckoutConfig<TReference extends string = string> =
  | SuperwallCheckoutMode
  | { mode: SuperwallCheckoutMode; prefetch?: TReference | false; managedPayments?: boolean };

export type SuperwallManagedPaymentsOverride = "USE_MANAGED_PAYMENTS" | "USE_DEFAULT_PAYMENTS";

export const checkoutModeOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): SuperwallCheckoutMode | undefined => (typeof checkout === "string" ? checkout : checkout?.mode);

export const checkoutPrefetchOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): string | false | undefined => (typeof checkout === "object" ? checkout.prefetch : undefined);

export const checkoutManagedPaymentsOf = (
  checkout: SuperwallCheckoutConfig | undefined,
): SuperwallManagedPaymentsOverride | undefined => {
  const override = typeof checkout === "object" ? checkout.managedPayments : undefined;
  if (override === undefined) return undefined;
  return override ? "USE_MANAGED_PAYMENTS" : "USE_DEFAULT_PAYMENTS";
};
