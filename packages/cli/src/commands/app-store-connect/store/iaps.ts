import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { runIapsCreate, IAP_TYPES, runIapsList, runIapsDelete, runIapsGet, runIapsUpdate } from "@/core/app-store-connect/resources/iaps";

export const command = defineAscResource({
  name: "asc iaps",
  summary: "In-app purchases: consumables, non-consumables and non-renewing subscriptions",
  operations: [
    {
      name: "list",
      summary: "The app's in-app purchases",
      args: [{ name: "asc-app", describe: "The App Store app: its App Store Connect id or bundle ID", required: true }],
      flags: {
        productId: { type: "string", value: "id", describe: "Only this product ID" },
        state: { type: "string", value: "state", describe: "Only in this state, e.g. MISSING_METADATA" },
        inAppPurchaseType: { type: "string", value: "type", describe: "Only of this type", choices: IAP_TYPES },
      },
      effect: "read",
      run: runIapsList,
    },
    {
      name: "get",
      summary: "One in-app purchase: localizations, price schedule, availability, version state and what is missing",
      args: [{ name: "id", describe: "The in-app purchase's id", required: true }],
      effect: "read",
      run: runIapsGet,
    },
    {
      name: "create",
      summary: "Create an in-app purchase with its localization, availability and price",
      flags: {
        ascApp: { type: "string", value: "id|bundle id", describe: "The App Store app", required: true },
        productId: { type: "string", value: "id", describe: "The product ID the app buys", required: true },
        name: { type: "string", value: "name", describe: "Its name in App Store Connect", required: true },
        inAppPurchaseType: { type: "string", value: "type", describe: "What it is", required: true, choices: IAP_TYPES },
        price: { type: "number", value: "amount", describe: "Its price in --territory, e.g. 4.99; Apple equalizes the rest" },
        territory: { type: "string", value: "code", describe: "The territory --price is in (default USA)" },
        availableTerritories: { type: "string", value: "all|USA,CAN", describe: "Where it is sold (default all)" },
        availableInNewTerritories: { type: "boolean", describe: "Sell it in territories Apple adds later (default: with all)" },
        displayName: { type: "string", value: "name", describe: "Its name on the App Store, in --locale" },
        description: { type: "string", value: "text", describe: "Its description on the App Store, in --locale" },
        locale: { type: "string", value: "locale", describe: "The localization's locale (default en-US)" },
        familySharable: { type: "boolean", describe: "Family Sharing" },
        reviewNote: { type: "string", value: "text", describe: "A note for App Review" },
      },
      effect: "write",
      run: runIapsCreate,
    },
    {
      name: "update",
      summary: "Change an in-app purchase",
      details: "PATCH replaces existing IAP fields, including family-sharing configuration when accepted by Apple.",
      args: [{ name: "id", describe: "The in-app purchase's id", required: true }],
      flags: {
        name: { type: "string", value: "name", describe: "Its name in App Store Connect" },
        familySharable: { type: "boolean", describe: "Family Sharing" },
        reviewNote: { type: "string", value: "text", describe: "A note for App Review" },
      },
      effect: "destructive",
      run: runIapsUpdate,
    },
    {
      name: "delete",
      summary: "Delete an in-app purchase",
      args: [{ name: "id", describe: "The in-app purchase's id", required: true }],
      effect: "destructive",
      run: runIapsDelete,
    },
  ],
  examples: [
    ["asc iaps list com.example.app", "The app's in-app purchases"],
    [
      "asc iaps create --asc-app com.example.app --product-id coins.100 --name '100 Coins' --in-app-purchase-type consumable --price 0.99 --display-name '100 Coins'",
      "A consumable, priced and localized",
    ],
  ],
});
