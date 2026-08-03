import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Web Funnel",

  /**
   * How a purchase completes on the web.
   *
   * `sheet` takes payment in the page: Superwall creates a Stripe checkout
   * session and renders it in a sheet over this funnel, so nobody leaves for
   * a hosted page mid-flow. `external` navigates to Superwall's hosted
   * checkout instead, and `applePay` goes straight to Apple Pay where the
   * device offers it.
   *
   * Only `sheet` and `applePay` carry Stripe's payment UI into the bundle;
   * a native paywall that omits this key carries none of it.
   *
   * https://superwall.com/docs/web-checkout
   */
  checkout: "sheet",

  /**
   * Stripe products, as `reference: "store identifier"`. Web identifiers are
   * `{environment}:{priceId}:{offer}` — the Stripe price is inside the
   * identifier, so nothing here needs a separate mapping.
   *
   * Replace these with products from your own Superwall app; prices come from
   * Stripe at runtime, never from this file.
   */
  products: {
    monthly: "test:price_1SVzqc9XrIjVpXCiS0PfI4wW:no-trial",
  },
});
