import { definePaywall, v } from "superwall";

export default definePaywall({
  products: {
    go: "chatgpt_go_499_month",
    plus: "chatgpt_plus_1999_month",
  },

  variables: {
    defaultPlan: v.enum(["go", "plus"], {
      default: "plus",
      label: "Plan selected when the paywall opens",
    }),
    showWebCheckout: v.boolean({
      default: true,
      label: "Show the purchase-on-web link",
    }),
  },

  // Dev/preview only: the mock SDK host delivers these instead of synthesized
  // placeholders. Inside a real SDK webview, StoreKit prices arrive instead.
  preview: {
    products: [
      {
        reference: "go",
        product: "go",
        productId: "chatgpt_go_499_month",
        variables: {
          price: "$4.99",
          rawPrice: 4.99,
          period: "month",
          periodly: "monthly",
          monthlyPrice: "$4.99",
          currencyCode: "USD",
          currencySymbol: "$",
        },
      },
      {
        reference: "plus",
        product: "plus",
        productId: "chatgpt_plus_1999_month",
        variables: {
          price: "$19.99",
          rawPrice: 19.99,
          period: "month",
          periodly: "monthly",
          monthlyPrice: "$19.99",
          currencyCode: "USD",
          currencySymbol: "$",
        },
      },
    ],
  },
});
