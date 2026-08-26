import { definePaywall } from "superwall/config";

export default definePaywall({
  presentation: { style: "drawer", drawer: { height: 60 } },
  featureGating: "gated",
  onDeviceCacheEnabled: false,
  gameControllerEnabled: true,
  introductoryOfferEligibility: "alwaysIneligible",
  products: {},
});
