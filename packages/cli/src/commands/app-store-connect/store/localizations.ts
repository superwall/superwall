import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { runLocalizationsAdd, runLocalizationsList, runLocalizationsDelete, runLocalizationsUpdate } from "@/core/app-store-connect/resources/localizations";
import { TARGET_FLAGS } from "@/core/app-store-connect/resources/targets";

export const command = defineAscResource({
  name: "asc localizations",
  summary: "The App Store names and descriptions of a subscription, group or in-app purchase",
  details: `Each takes one of --subscription, --group or --iap. A localization belongs to a version
of the product; changes go to its editable version, and an approved product gets a new one.`,
  operations: [
    {
      name: "list",
      summary: "Localizations of the latest version",
      flags: TARGET_FLAGS,
      effect: "read",
      run: runLocalizationsList,
    },
    {
      name: "add",
      summary: "Add a localization",
      flags: {
        ...TARGET_FLAGS,
        locale: { type: "string", value: "locale", describe: "Its locale, e.g. en-US", required: true },
        name: { type: "string", value: "name", describe: "The name on the App Store", required: true },
        description: { type: "string", value: "text", describe: "The description (subscriptions and in-app purchases)" },
        customAppName: { type: "string", value: "name", describe: "The app name shown with a group (groups only)" },
      },
      effect: "write",
      run: runLocalizationsAdd,
    },
    {
      name: "update",
      summary: "Change the localization in --locale",
      flags: {
        ...TARGET_FLAGS,
        locale: { type: "string", value: "locale", describe: "The locale to change", required: true },
        name: { type: "string", value: "name", describe: "The name on the App Store" },
        description: { type: "string", value: "text", describe: "The description (subscriptions and in-app purchases)" },
        customAppName: { type: "string", value: "name", describe: "The app name shown with a group (groups only)" },
      },
      effect: "write",
      run: runLocalizationsUpdate,
    },
    {
      name: "delete",
      summary: "Delete the localization in --locale",
      flags: { ...TARGET_FLAGS, locale: { type: "string", value: "locale", describe: "The locale to delete", required: true } },
      effect: "destructive",
      run: runLocalizationsDelete,
    },
  ],
  examples: [
    ["asc localizations list --subscription <id>", "A subscription's localizations"],
    ["asc localizations add --subscription <id> --locale de-DE --name 'Pro Monatlich'", "Add German"],
  ],
});
