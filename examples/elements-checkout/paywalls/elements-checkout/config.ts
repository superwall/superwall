import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Elements checkout",

  /**
   * What the host paints behind the paywall, per scheme. `--sw-background` in
   * theme.css paints the routes; this is what shows when an iOS scroll
   * rubber-bands past the content, so the two carry the same colours.
   */
  background: { light: "#fdfef6", dark: "#0c0d0f" },

  localization: { defaultLocale: "en" },

  /**
   * `elements` lets the paywall build its own checkout form from Stripe's
   * elements, with `<Checkout>` from `superwall/checkout`. superwall prices
   * the form, takes the payment and completes the purchase, as it does for
   * Apple Pay and the sheet. `prefetch` loads the first plan's price as the
   * paywall opens, so the form renders without a wait; `<Checkout>` loads
   * any other plan's price when the shopper picks it.
   */
  checkout: { mode: "elements", prefetch: "trial" },

  /**
   * Stripe products, as `reference: "store identifier"`. Web identifiers are
   * `{environment}:{priceId}:{offer}`: the price lives in the identifier, and
   * the offer suffix is Superwall's, so one Stripe price can be sold with or
   * without a free trial.
   */
  products: {
    trial: "test:price_1R7OiTBmoUO4I4NSACz7JoAy:3days-free",
    monthly: "test:price_1RJpYPBmoUO4I4NSX0AUMLee:no-trial",
  },
});
