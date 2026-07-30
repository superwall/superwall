import { definePaywall } from "superwall/config";

export default definePaywall({
  /** What this paywall is called on Superwall. Defaults to the directory name. */
  name: "Pro — Trial Reminders",

  /**
   * Scheduled automatically when the SDK reports a trial started. Nothing to
   * wire up — the paywall does not have to be open when it fires.
   */
  notifications: {
    trialReminder: {
      title: "Your trial ends tomorrow",
      body: "Keep Pro, or cancel in Settings — no charge either way.",
      beforeTrialEndDays: 1,
    },
  },

  /**
   * The products this paywall sells, as `reference: "store identifier"`.
   *
   * The identifiers below are placeholders — replace them with products that
   * exist in your Superwall dashboard. Nothing about a product is stored here:
   * price, period and trial all come from the store at runtime, which is why
   * `useProducts()` returns nothing until these match. Run `superwall dev`
   * against a connected app and the real prices appear, locally and on device.
   *
   * A reference the dashboard has no product for blocks publishing, so a
   * paywall can never ship with prices it cannot render.
   */
  products: {
    annual: "pro_5999_year",
  },
});
