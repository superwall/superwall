import { definePaywall } from "superwall/config";

export default definePaywall({
  platforms: ["ios", "android"],
  products: {
    monthly: "pro_999_month",
    annual: { ios: "pro_5999_year", android: "pro_5999_year_play" },
  },
});
