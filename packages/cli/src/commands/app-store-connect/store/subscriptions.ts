import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { OFFER_DURATIONS } from "@/core/app-store-connect/resources/offers";
import {
  runSubscriptionsCreate,
  runSubscriptionsList,
  runSubscriptionsDelete,
  runSubscriptionsGet,
  SUBSCRIPTION_PERIODS,
  runSubscriptionsUpdate,
} from "@/core/app-store-connect/resources/subscriptions";

export const command = defineAscResource({
  name: "asc subscriptions",
  summary: "Auto-renewable subscriptions: list, inspect, create one ready for review, change, delete",
  details: `create runs every step Apple needs, in order: the subscription, its localization
(with --display-name), where it is sold, its price in --territory equalized to every other
territory, and a free trial (with --trial). It ends by reading the subscription back: its
state and what is still missing.`,
  operations: [
    {
      name: "list",
      summary: "Subscriptions of every group of the app, or of one --group",
      args: [{ name: "asc-app", describe: "The App Store app: its App Store Connect id or bundle ID" }],
      flags: { group: { type: "string", value: "id|name", describe: "Only this group; a name needs <asc-app>" } },
      effect: "read",
      run: runSubscriptionsList,
    },
    {
      name: "get",
      summary: "One subscription: localizations, prices, offers, availability, version state and what is missing",
      args: [{ name: "id", describe: "The subscription's id", required: true }],
      effect: "read",
      run: runSubscriptionsGet,
    },
    {
      name: "create",
      summary: "Create a subscription with its localization, availability, prices and free trial",
      flags: {
        group: { type: "string", value: "id|name", describe: "Its subscription group; a name needs --asc-app", required: true },
        ascApp: { type: "string", value: "id|bundle id", describe: "The App Store app, to find --group by name" },
        productId: { type: "string", value: "id", describe: "The product ID the app buys", required: true },
        name: { type: "string", value: "name", describe: "Its name in App Store Connect", required: true },
        subscriptionPeriod: { type: "string", value: "period", describe: "How long one period lasts", required: true, choices: SUBSCRIPTION_PERIODS },
        price: { type: "number", value: "amount", describe: "Its price in --territory, e.g. 9.99", required: true },
        territory: { type: "string", value: "code", describe: "The territory --price is in (default USA)" },
        availableTerritories: { type: "string", value: "all|USA,CAN", describe: "Where it is sold (default all)" },
        availableInNewTerritories: { type: "boolean", describe: "Sell it in territories Apple adds later (default: with all)" },
        displayName: { type: "string", value: "name", describe: "Its name on the App Store, in --locale" },
        description: { type: "string", value: "text", describe: "Its description on the App Store, in --locale" },
        locale: { type: "string", value: "locale", describe: "The localization's locale (default en-US)" },
        trial: { type: "string", value: "duration", describe: "A free trial this long, in every territory", choices: OFFER_DURATIONS },
        familySharable: { type: "boolean", describe: "Family Sharing" },
        groupLevel: { type: "number", value: "n", describe: "Its rank in the group: 1 is the highest" },
        reviewNote: { type: "string", value: "text", describe: "A note for App Review" },
      },
      effect: "write",
      run: runSubscriptionsCreate,
    },
    {
      name: "update",
      summary: "Change a subscription",
      details: "PATCH replaces subscription attributes, including period, group level and family-sharing configuration when accepted by Apple.",
      args: [{ name: "id", describe: "The subscription's id", required: true }],
      flags: {
        name: { type: "string", value: "name", describe: "Its name in App Store Connect" },
        subscriptionPeriod: { type: "string", value: "period", describe: "How long one period lasts", choices: SUBSCRIPTION_PERIODS },
        familySharable: { type: "boolean", describe: "Family Sharing" },
        groupLevel: { type: "number", value: "n", describe: "Its rank in the group: 1 is the highest" },
        reviewNote: { type: "string", value: "text", describe: "A note for App Review" },
      },
      effect: "destructive",
      run: runSubscriptionsUpdate,
    },
    {
      name: "delete",
      summary: "Delete a subscription Apple has never reviewed",
      args: [{ name: "id", describe: "The subscription's id", required: true }],
      effect: "destructive",
      run: runSubscriptionsDelete,
    },
  ],
  examples: [
    ["asc subscriptions list com.example.app", "Every subscription of the app"],
    [
      "asc subscriptions create --group <id> --product-id pro.monthly --name 'Pro Monthly' --subscription-period ONE_MONTH --price 9.99 --display-name Pro --trial ONE_WEEK",
      "A monthly subscription with a week's free trial, priced everywhere",
    ],
  ],
});
