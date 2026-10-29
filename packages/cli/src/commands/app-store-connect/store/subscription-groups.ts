import { defineAscResource } from "@/core/app-store-connect/resources/define";
import {
  runSubscriptionGroupsCreate,
  runSubscriptionGroupsList,
  runSubscriptionGroupsDelete,
  runSubscriptionGroupsGet,
  runSubscriptionGroupsUpdate,
} from "@/core/app-store-connect/resources/subscription-groups";

export const command = defineAscResource({
  name: "asc subscription-groups",
  summary: "Subscription groups of an App Store app, and their localizations",
  operations: [
    {
      name: "list",
      summary: "The app's subscription groups",
      args: [{ name: "asc-app", describe: "The App Store app: its App Store Connect id or bundle ID", required: true }],
      effect: "read",
      run: runSubscriptionGroupsList,
    },
    {
      name: "get",
      summary: "One group: its version, localizations, subscriptions and what is missing",
      args: [{ name: "id", describe: "The subscription group's id", required: true }],
      effect: "read",
      run: runSubscriptionGroupsGet,
    },
    {
      name: "create",
      summary: "Create a group, and its first localization when --display-name is given",
      flags: {
        ascApp: { type: "string", value: "id|bundle id", describe: "The App Store app", required: true },
        referenceName: { type: "string", value: "name", describe: "The group's name in App Store Connect", required: true },
        displayName: { type: "string", value: "name", describe: "The group's name on the App Store, in --locale" },
        customAppName: { type: "string", value: "name", describe: "The app name shown with the group, in --locale" },
        locale: { type: "string", value: "locale", describe: "The localization's locale (default en-US)" },
      },
      effect: "write",
      run: runSubscriptionGroupsCreate,
    },
    {
      name: "update",
      summary: "Rename a group",
      details: "PATCH replaces the existing group reference name.",
      args: [{ name: "id", describe: "The subscription group's id", required: true }],
      flags: { referenceName: { type: "string", value: "name", describe: "The group's new name in App Store Connect", required: true } },
      effect: "destructive",
      run: runSubscriptionGroupsUpdate,
    },
    {
      name: "delete",
      summary: "Delete a group",
      args: [{ name: "id", describe: "The subscription group's id", required: true }],
      confirm: true,
      effect: "destructive",
      run: runSubscriptionGroupsDelete,
    },
  ],
  examples: [
    ["asc subscription-groups list com.example.app", "The app's groups"],
    ["asc subscription-groups create --asc-app com.example.app --reference-name Pro --display-name Pro", "A group with its en-US name"],
  ],
});
