import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { runAvailabilityGet, runAvailabilitySet } from "@/core/app-store-connect/resources/availability";
import { TARGET_FLAGS } from "@/core/app-store-connect/resources/targets";

export const command = defineAscResource({
  name: "asc availability",
  summary: "Where a subscription or in-app purchase is sold",
  operations: [
    {
      name: "get",
      summary: "The territories it is sold in",
      flags: { subscription: TARGET_FLAGS.subscription, iap: TARGET_FLAGS.iap },
      effect: "read",
      run: runAvailabilityGet,
    },
    {
      name: "set",
      summary: "Sell it in these territories",
      flags: {
        subscription: TARGET_FLAGS.subscription,
        iap: TARGET_FLAGS.iap,
        availableTerritories: { type: "string", value: "all|USA,CAN", describe: "Every territory, or a list", required: true },
        availableInNewTerritories: { type: "boolean", describe: "Also territories Apple adds later (default: with all)" },
      },
      effect: "write",
      run: runAvailabilitySet,
    },
  ],
  examples: [
    ["asc availability get --subscription <id>", "Where it is sold"],
    ["asc availability set --iap <id> --available-territories USA,CAN", "Sell it in two territories"],
  ],
});
