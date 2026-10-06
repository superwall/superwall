import { definePaywall } from "superwall/config";

export default definePaywall({
  /** What this surface is called on Superwall. Defaults to the directory name. */
  name: "Onboarding — Animated",

  /**
   * Every page names its own hand-off (`export const transition = "story-…"`),
   * so this default only covers a navigation that names none: the plain
   * funnel step.
   */
  transition: "shift",

  /**
   * The page background in both schemes. `--sw-background` paints the routes;
   * this is what the framework writes on <html>, which iOS shows when a scroll
   * rubber-bands past the end. Keep them identical (theme.css).
   */
  background: { light: "#fdfef6", dark: "#1c1b19" },

  /**
   * The last page offers the plan. The identifier is a placeholder — point it
   * at a product that exists in your dashboard, or the price renders empty.
   */
  products: {
    annual: "pro_5999_year",
  },
});
