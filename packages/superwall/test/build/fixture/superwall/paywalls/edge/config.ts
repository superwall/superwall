import { definePaywall } from "superwall/config";

export default definePaywall({
  platforms: ["ios"],
  teleport: { route: "checkout" },
  products: {
    annual: "stripe|live:price_annual",
    monthly: "stripe|live:price_monthly",
  },
});
