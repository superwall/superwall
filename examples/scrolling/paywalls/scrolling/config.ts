import { definePaywall } from "superwall/config";

export default definePaywall({
  /** What this paywall is called on Superwall. Defaults to the directory name. */
  name: "Pro — Scrolling",

  /**
   * What the host paints behind the paywall, per scheme. `--sw-background` in
   * theme.css paints the routes; this is what shows when an iOS scroll
   * rubber-bands past the content, so the two carry the same colours.
   */
  background: { light: "#fdfef6", dark: "#0c0d0f" },

  /**
   * The products this paywall sells, as `reference: "store identifier"`.
   * The identifier is a placeholder — point it at a product in your dashboard.
   */
  products: {
    monthly: "pro_999_month",
  },
});
