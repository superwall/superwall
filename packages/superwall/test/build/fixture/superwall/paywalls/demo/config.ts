import { definePaywall } from "superwall/config";

export default definePaywall({
  products: { primary: "demo_monthly" },
  background: { light: "#ffffff", dark: "#0d0f12" },
});
