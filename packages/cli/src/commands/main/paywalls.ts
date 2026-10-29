import { LIST_FLAGS } from "@/core/main/catalog";
import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "paywalls",
  summary: "Paywalls in the dashboard",
  operations: [
    { name: "list", summary: "Paywalls of an app", effect: "read", handler: "resource", flags: LIST_FLAGS },
    { name: "get", summary: "One paywall", effect: "read", method: "GET", path: "/v2/paywalls/{id}" },
    { name: "create", summary: "Create a paywall", effect: "write", method: "POST", path: "/v2/paywalls" },
    { name: "duplicate", summary: "Copy a paywall", effect: "write", method: "POST", path: "/v2/paywalls/{id}/duplicate" },
    {
      name: "publish",
      summary: "Publish the latest saved draft of a paywall",
      effect: "destructive",
      details: "Replaces its currently deployed version and refreshes app configuration. This can change the paywall shown to users by campaigns that use it.",
      method: "POST",
      path: "/v2/paywalls/{id}/publish",
      destructive: true,
    },
    {
      name: "archive",
      summary: "Archive it",
      effect: "destructive",
      method: "POST",
      path: "/v2/paywalls/{id}/archive",
      destructive: true,
    },
    { name: "unarchive", summary: "Bring it back", effect: "write", method: "POST", path: "/v2/paywalls/{id}/unarchive" },
    {
      name: "versions",
      summary: "Versions pushed from code",
      effect: "read",
      method: "GET",
      path: "/v2/paywalls/{id}/versions",
      list: true,
    },
  ],
  examples: [
    ["paywalls list --app <app>", "Paywalls of one app"],
    ["paywalls get <paywall>", "One paywall in full"],
  ],
});
