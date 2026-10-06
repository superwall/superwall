import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Apple Pay",

  /**
   * What the host paints behind the paywall, per scheme. `--sw-background` in
   * theme.css paints the routes; this is what shows when an iOS scroll
   * rubber-bands past the content, so the two carry the same colours.
   */
  background: { light: "#fdfef6", dark: "#0c0d0f" },

  /**
   * `useDiscount` hands back the discount in parts, never a sentence, so the
   * phrase a shopper reads is assembled from these strings and translates
   * with the rest of the paywall.
   */
  localization: { defaultLocale: "en" },

  /**
   * `applePay` opens the native Apple Pay sheet where the device offers it,
   * and falls back to Stripe's in-page sheet everywhere else. Both are
   * prepared ahead of the tap, so the wallet opens on the first press.
   *
   * Free trials and paid intro offers are quoted to Apple as a recurring
   * payment with a trial line, so the sheet says "3-Day Free Trial" and names
   * the price that follows it.
   */
  checkout: { mode: "applePay", prefetch: "trial" },

  /**
   * Stripe products, as `reference: "store identifier"`. Web identifiers are
   * `{environment}:{priceId}:{offer}` — the price lives in the identifier, and
   * the offer suffix is Superwall's, so one Stripe price can be sold with no
   * trial, a free trial, or a paid intro offer.
   */
  products: {
    trial: "test:price_1R7OiTBmoUO4I4NSACz7JoAy:3days-free",
    intro: "test:price_1RJpYPBmoUO4I4NSX0AUMLee:intro_349_3days",
    monthly: "test:price_1RJpYPBmoUO4I4NSX0AUMLee:no-trial",
  },
});
