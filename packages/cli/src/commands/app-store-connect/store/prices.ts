import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { runPricesPoints, runPricesList, runPricesSet } from "@/core/app-store-connect/resources/prices";
import { TARGET_FLAGS } from "@/core/app-store-connect/resources/targets";

export const command = defineAscResource({
  name: "asc prices",
  summary: "Prices of a subscription or in-app purchase, and Apple's price points",
  details: `Each takes --subscription or --iap. set on a subscription prices it in --territory and
writes Apple's equalized price to every territory it is available in, in one request. set on
an in-app purchase replaces its price schedule; Apple equalizes the other territories itself.`,
  operations: [
    {
      name: "points",
      summary: "Apple's price points in one territory, or the one at --price",
      flags: {
        subscription: TARGET_FLAGS.subscription,
        iap: TARGET_FLAGS.iap,
        territory: { type: "string", value: "code", describe: "The territory (default USA)" },
        price: { type: "number", value: "amount", describe: "Only the point at this customer price" },
      },
      effect: "read",
      run: runPricesPoints,
    },
    {
      name: "list",
      summary: "Current and scheduled prices in every territory",
      flags: { subscription: TARGET_FLAGS.subscription, iap: TARGET_FLAGS.iap },
      effect: "read",
      run: runPricesList,
    },
    {
      name: "set",
      summary: "Price it in one territory and equalize every other",
      details: "Replaces an IAP price schedule or updates subscription prices across available territories. Existing-subscriber price preservation is optional.",
      flags: {
        subscription: TARGET_FLAGS.subscription,
        iap: TARGET_FLAGS.iap,
        price: { type: "number", value: "amount", describe: "The customer price in --territory, e.g. 9.99", required: true },
        territory: { type: "string", value: "code", describe: "The territory --price is in (default USA)" },
        preserveCurrentPrice: { type: "boolean", describe: "Subscriptions: existing subscribers keep their price" },
        startDate: { type: "string", value: "yyyy-mm-dd", describe: "Subscriptions: when the price takes effect (default now)" },
      },
      effect: "destructive",
      run: runPricesSet,
    },
  ],
  examples: [
    ["asc prices points --subscription <id> --territory USA --price 9.99", "The USA price point at 9.99"],
    ["asc prices set --subscription <id> --price 9.99 --preserve-current-price", "Reprice, keeping current subscribers' price"],
  ],
});
