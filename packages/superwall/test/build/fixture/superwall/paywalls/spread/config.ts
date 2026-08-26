import { definePaywall } from "superwall/config";

const shared = {
  platforms: ["ios", "android"],
  products: { annual: { ios: "spread_year", android: "spread_year_play" } },
} as const;

export default definePaywall({ ...shared, name: "Spread" });
