import { defineConfig } from "superwall";

export default defineConfig({
  applicationId: "7",

  defaults: {
    presentation: {
      style: "fullscreen",
      condition: "checkUserSubscription",
    },
    featureGating: "nonGated",
    introductoryOfferEligibility: "automatic",
    dismissOnPurchase: true,
    purchaseTimeoutMs: 1000 * 60 * 5,
  },
});
