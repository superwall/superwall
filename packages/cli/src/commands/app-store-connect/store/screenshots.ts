import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { runScreenshotsUpload } from "@/core/app-store-connect/resources/screenshots";
import { TARGET_FLAGS } from "@/core/app-store-connect/resources/targets";

export const command = defineAscResource({
  name: "asc screenshots",
  summary: "The App Review screenshot of a subscription or in-app purchase",
  operations: [
    {
      name: "upload",
      summary: "Upload the review screenshot, replacing the current one",
      args: [{ name: "file", describe: "The screenshot: a PNG or JPEG of the purchase in the app", required: true }],
      flags: { subscription: TARGET_FLAGS.subscription, iap: TARGET_FLAGS.iap },
      effect: false,
      run: runScreenshotsUpload,
    },
  ],
  examples: [["asc screenshots upload --subscription <id> paywall.png", "Upload the paywall screenshot"]],
});
