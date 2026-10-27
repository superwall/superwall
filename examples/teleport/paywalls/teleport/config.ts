import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Teleport",

  /** The page background per scheme — what <html> shows when a scroll bounces past the content. Matches `--bg` in theme.css. */
  background: { light: "#fdfef6", dark: "#0c0d0f" },

  transition: "shift",

  /**
   * From `plan` on, the flow continues on the web. In an iOS app, pushing
   * `plan` opens it in the shopper's browser instead, with the goal they
   * picked already set; they pay with Stripe there and come back to the app,
   * which is credited on its own. The teleport is prepared when the paywall
   * opens, so the browser opens at once.
   *
   * `fallbacks` lets the teleport screen offer the App Store plan in place of
   * the Stripe one, for anyone who would rather not leave the app.
   *
   * Where teleport can't run (Android, an SDK before 4.18.0) `plan` opens in
   * the app as usual and a Stripe purchase goes to Superwall's hosted
   * checkout instead.
   *
   * https://superwall.com/docs/framework/teleport
   */
  teleport: { route: "plan", fallbacks: { monthly: "annual" } },

  /**
   * `monthly` and `pro` are Stripe products, sold on the web page; `annual`
   * is an App Store product, the in-app fallback. Placeholders: swap in
   * products from your own Superwall app (`superwall products` lists them).
   * Prices come from the stores at runtime, never from this file.
   */
  products: {
    monthly: "test:price_YOUR_MONTHLY_PRICE:7days-free",
    pro: "test:price_YOUR_PRO_PRICE:no-trial",
    annual: "pro_5999_year",
  },
});
