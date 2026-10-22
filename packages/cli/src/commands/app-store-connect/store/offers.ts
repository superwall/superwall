import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { runOffersCreate, runOffersList, OFFER_DURATIONS, OFFER_MODES, runOffersDelete, runOffersUpdate } from "@/core/app-store-connect/resources/offers";

export const command = defineAscResource({
  name: "asc offers",
  summary: "Introductory offers of a subscription: free trials and discounted first periods",
  details: `Apple keeps one introductory offer per territory. create writes it to every territory the
subscription is available in (or --available-territories) in one request; a paid offer is
priced in --territory and equalized.`,
  operations: [
    {
      name: "list",
      summary: "A subscription's introductory offers, one per territory",
      flags: { subscription: { type: "string", value: "id", describe: "The subscription's id", required: true } },
      effect: "read",
      run: runOffersList,
    },
    {
      name: "create",
      summary: "Create an introductory offer in every territory",
      flags: {
        subscription: { type: "string", value: "id", describe: "The subscription's id", required: true },
        offerMode: { type: "string", value: "mode", describe: "What the customer pays", required: true, choices: OFFER_MODES },
        duration: { type: "string", value: "duration", describe: "How long it lasts", required: true, choices: OFFER_DURATIONS },
        numberOfPeriods: { type: "number", value: "n", describe: "How many periods (default 1)" },
        price: { type: "number", value: "amount", describe: "PAY_AS_YOU_GO and PAY_UP_FRONT: the price in --territory" },
        territory: { type: "string", value: "code", describe: "The territory --price is in (default USA)" },
        availableTerritories: { type: "string", value: "all|USA,CAN", describe: "Where to offer it (default: where the subscription is sold)" },
        startDate: { type: "string", value: "yyyy-mm-dd", describe: "When it starts" },
        endDate: { type: "string", value: "yyyy-mm-dd", describe: "When it ends" },
      },
      effect: "write",
      run: runOffersCreate,
    },
    {
      name: "update",
      summary: "Change when one offer ends",
      args: [{ name: "id", describe: "The offer's id", required: true }],
      flags: { endDate: { type: "string", value: "yyyy-mm-dd", describe: "When it ends", required: true } },
      effect: "write",
      run: runOffersUpdate,
    },
    {
      name: "delete",
      summary: "Delete one offer, or every offer of --subscription",
      args: [{ name: "id", describe: "The offer's id" }],
      flags: { subscription: { type: "string", value: "id", describe: "Delete all of this subscription's offers" } },
      effect: "destructive",
      run: runOffersDelete,
    },
  ],
  examples: [
    ["asc offers create --subscription <id> --offer-mode FREE_TRIAL --duration ONE_WEEK", "A week's free trial everywhere"],
    ["asc offers list --subscription <id>", "The offers, per territory"],
  ],
});
