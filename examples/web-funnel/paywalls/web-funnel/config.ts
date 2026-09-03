import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Web Funnel",

  /**
   * How steps move. `shift` is the funnel transition: the next step fades in
   * as it drifts into place, and the one it replaces is simply gone.
   */
  transition: "shift",

  /**
   * Because `checkout` is set, the route stack and every `useQueryState`
   * value live in the page URL — so the flow resumes from any link: after a
   * reload, in Safari after Instagram's in-app browser, or back from hosted
   * checkout. Set `queryState: false` to keep the URL clean instead.
   */

  /**
   * How a purchase completes on the web.
   *
   * `sheet` takes payment in the page: Superwall creates a Stripe checkout
   * session and renders it in a sheet over this funnel, so nobody leaves for
   * a hosted page mid-flow. `external` navigates to Superwall's hosted
   * checkout instead, and `applePay` goes straight to Apple Pay where the
   * device offers it — free trials and intro offers show as such on the
   * sheet — and falls back to the in-page sheet everywhere else.
   *
   * Only `sheet` and `applePay` carry Stripe's payment UI into the bundle;
   * a native paywall that omits this key carries none of it.
   *
   * https://superwall.com/docs/web-checkout
   */
  checkout: { mode: "sheet", prefetch: "monthly" },

  /**
   * Stripe products, as `reference: "store identifier"`. Web identifiers are
   * `{environment}:{priceId}:{offer}` — the Stripe price is inside the
   * identifier, so nothing here needs a separate mapping.
   *
   * These are placeholders: swap in prices from your own Superwall app
   * (`superwall products` lists them) before publishing. Prices come from
   * Stripe at runtime, never from this file — until then the paywall renders
   * its price fallbacks.
   */
  products: {
    monthly: "test:price_YOUR_MONTHLY_PRICE:no-trial",
    pro: "test:price_YOUR_PRO_PRICE:no-trial",
  },
});
