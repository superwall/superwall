import { definePaywall, v } from "superwall/config";

export default definePaywall({
  transition: "zoom",

  products: {
    monthly: "fitness_999_month",
    annual: "fitness_5999_year",
  },

  variables: {
    skippableOnboarding: v.boolean({
      default: false,
      label: "Let people jump straight to the plans",
    }),
    defaultPlan: v.enum(["monthly", "annual"], {
      default: "annual",
      label: "Plan selected when the paywall opens",
    }),
  },

  preview: {
    products: [
      {
        reference: "monthly",
        product: "monthly",
        productId: "fitness_999_month",
        variables: {
          price: "$9.99",
          rawPrice: 9.99,
          period: "month",
          periodly: "monthly",
          monthlyPrice: "$9.99",
          currencyCode: "USD",
          currencySymbol: "$",
        },
      },
      {
        reference: "annual",
        product: "annual",
        productId: "fitness_5999_year",
        variables: {
          price: "$59.99",
          rawPrice: 59.99,
          period: "year",
          periodly: "yearly",
          monthlyPrice: "$5.00",
          currencyCode: "USD",
          currencySymbol: "$",
        },
      },
    ],
  },
});
